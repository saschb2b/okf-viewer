import type { AgentSourceInput, IntakePlan } from "@/shared/ipc.ts";
import type { Issue, ProfileDiagnostic } from "@/shared/types.ts";
import type { OkfTaskId, OkfTaskKickoff } from "@/features/agent/taskContext.ts";

export type OkfTaskOrigin =
  | {
      kind: "concept" | "graph-selection" | "search-result";
      id: string;
      title: string;
      conceptId: string;
    }
  | {
      kind: "validation-finding";
      id: string;
      title: string;
      issue: Issue;
    }
  | {
      kind: "profile-finding";
      id: string;
      title: string;
      conceptId: string | null;
      diagnostic: ProfileDiagnostic;
    }
  | {
      kind: "citation";
      id: string;
      title: string;
      conceptId: string;
      url: string;
    }
  | {
      kind: "source";
      id: string;
      title: string;
      source: AgentSourceInput;
    }
  | {
      kind: "external";
      id: string;
      title: string;
      conceptId: string;
    }
  | {
      kind: "intake-plan";
      id: string;
      title: string;
      plan: IntakePlan;
      /** The session-held attachment evidence the plan was computed from. */
      sources: AgentSourceInput[];
    };

export interface OkfTaskLaunchRequest {
  requestId: string;
  origin: OkfTaskOrigin;
  preferredTaskId?: OkfTaskId;
  promptDraft?: string;
  returnFocusId?: string;
  openedBundleFingerprint: string;
}

const ORIGIN_TASKS: Readonly<Record<OkfTaskOrigin["kind"], readonly OkfTaskId[]>> = {
  concept: ["okf-revise", "okf-audit", "okf-enrich", "okf-research", "okf-change-impact"],
  "graph-selection": ["okf-change-impact", "okf-audit", "okf-enrich"],
  "search-result": ["okf-research", "okf-change-impact", "okf-enrich"],
  "validation-finding": ["okf-repair", "okf-audit", "okf-research"],
  "profile-finding": ["okf-migrate", "okf-revise", "okf-audit"],
  citation: ["okf-research", "okf-enrich", "okf-change-impact"],
  source: ["okf-author", "okf-enrich", "okf-research", "okf-create"],
  "intake-plan": ["okf-enrich", "okf-create", "okf-author"],
  external: [
    "okf-create",
    "okf-enrich",
    "okf-audit",
    "okf-repair",
    "okf-research",
    "okf-change-impact",
    "okf-migrate",
    "okf-author",
    "okf-revise",
  ],
};

export function tasksForOkfOrigin(
  origin: OkfTaskOrigin,
  availableCapabilityIds?: ReadonlySet<string>,
): readonly OkfTaskId[] {
  const tasks = ORIGIN_TASKS[origin.kind];
  return availableCapabilityIds
    ? tasks.filter((taskId) => availableCapabilityIds.has(taskId))
    : tasks;
}

export function kickoffForOkfOrigin(
  taskId: OkfTaskId,
  origin: OkfTaskOrigin,
): OkfTaskKickoff {
  const contextConceptIds = "conceptId" in origin && origin.conceptId
    ? [origin.conceptId]
    : [];
  const sources: AgentSourceInput[] = [];
  let object = origin.title;

  if (origin.kind === "validation-finding") {
    object = `${origin.issue.level} finding: ${origin.issue.message}`;
    sources.push({
      title: `${origin.issue.level === "error" ? "Error" : "Warning"}: ${origin.issue.conceptId ?? "bundle"}`,
      content: origin.issue.message,
      origin: origin.issue.conceptId ? `${origin.issue.conceptId}.md` : "Bundle validation",
      mediaType: "text/plain",
    });
  } else if (origin.kind === "profile-finding") {
    object = `advisory profile finding: ${origin.diagnostic.message}`;
    sources.push({
      title: `Profile advice: ${origin.diagnostic.ruleId}`,
      content: [
        "Basis: advisory profile, not OKF validation",
        `Namespace: ${origin.diagnostic.namespace}`,
        `Rule: ${origin.diagnostic.ruleId}`,
        `Field: ${origin.diagnostic.field}`,
        `Level: ${origin.diagnostic.level}`,
        `Message: ${origin.diagnostic.message}`,
      ].join("\n"),
      origin: origin.diagnostic.file,
      mediaType: "text/plain",
    });
  } else if (origin.kind === "citation") {
    object = `citation ${origin.url}`;
    sources.push({
      title: `Citation from ${origin.title}`,
      content: origin.url,
      origin: origin.url,
      mediaType: "text/uri-list",
    });
  } else if (origin.kind === "source") {
    sources.push(origin.source);
  } else if (origin.kind === "intake-plan") {
    sources.push(...origin.sources);
    return {
      taskId,
      prompt: intakePlanPrompt(taskId, origin.plan),
      contextConceptIds,
      sources,
    };
  }

  return {
    taskId,
    prompt: taskPrompt(taskId, object),
    contextConceptIds,
    sources,
  };
}

function taskPrompt(taskId: OkfTaskId, object: string): string {
  const instruction: Readonly<Record<OkfTaskId, string>> = {
    "okf-create": "Plan a new OKF bundle from this evidence",
    "okf-enrich": "Propose a reviewed OKF enrichment grounded in this context",
    "okf-audit": "Audit this OKF context and explain the deterministic findings",
    "okf-repair": "Propose a reviewed repair for this OKF validation finding",
    "okf-research": "Explain this OKF context with cited evidence and separate inference",
    "okf-change-impact": "Assess the downstream OKF change impact of this context",
    "okf-migrate": "Plan an OKF migration for this context",
    "okf-author": "Write an OKF concept from this accepted evidence",
    "okf-revise": "Improve this OKF writing without changing its meaning",
  };
  return `${instruction[taskId]}: ${object}. Use the attached object as the starting scope, preview any scope expansion, and keep writes staged for review.`;
}

/** The deterministic prompt an intake thread starts from. Built from the
 *  plan alone, so what the agent is told matches what the plan resolved:
 *  kept concepts with spans, furniture that must not travel, unverified
 *  evidence candidates, and gaps no text may be invented for. */
function intakePlanPrompt(taskId: OkfTaskId, plan: IntakePlan): string {
  const kept = plan.concepts.filter((concept) => concept.included);
  const lines: string[] = [];
  lines.push(
    `${taskId === "okf-create" ? "Plan a new OKF bundle" : taskId === "okf-author" ? "Write OKF concepts" : "Propose a reviewed OKF enrichment"} from this intake plan: ${kept.length} kept concept${kept.length === 1 ? "" : "s"} from ${plan.sources.length} document${plan.sources.length === 1 ? "" : "s"}.`,
  );
  lines.push("Proposed concepts, one per entry, with their source spans:");
  for (const concept of kept.slice(0, 40)) {
    const span =
      concept.startPage === 0
        ? "whole document"
        : concept.untilPage > concept.startPage + 1
          ? `pages ${concept.startPage}-${concept.untilPage - 1}`
          : `page ${concept.startPage}`;
    lines.push(`- "${concept.title}" (${concept.sourceTitle}, ${span})`);
  }
  if (kept.length > 40) lines.push(`- and ${kept.length - 40} more`);
  if (plan.exclusions.length > 0) {
    lines.push(
      "Classified as page furniture; never carry these lines into a concept:",
    );
    for (const exclusion of plan.exclusions.slice(0, 10)) {
      lines.push(`- "${exclusion.text}" (${exclusion.reason})`);
    }
    if (plan.exclusions.length > 10) {
      lines.push(`- and ${plan.exclusions.length - 10} more`);
    }
  }
  if (plan.evidence.length > 0) {
    lines.push("Evidence candidates; cite them where used and treat each as unverified:");
    for (const entry of plan.evidence.slice(0, 20)) {
      lines.push(
        `- [${entry.marker}] ${entry.text}${entry.statedDate ? ` (stated ${entry.statedDate})` : ""}`,
      );
    }
    if (plan.evidence.length > 20) lines.push(`- and ${plan.evidence.length - 20} more`);
  }
  if (plan.gaps.length > 0) {
    lines.push("Named gaps; no text exists for these and none may be invented:");
    for (const gap of plan.gaps.slice(0, 10)) {
      lines.push(`- ${gap.caption} (${gap.sourceTitle}, page ${gap.page})`);
    }
    if (plan.gaps.length > 10) lines.push(`- and ${plan.gaps.length - 10} more`);
  }
  lines.push(
    "Anchor every claim to its source document and page. Keep writes staged for review.",
  );
  return lines.join("\n");
}

export function okfTaskOriginLabel(origin: OkfTaskOrigin): string {
  const labels: Readonly<Record<OkfTaskOrigin["kind"], string>> = {
    concept: "Concept",
    "graph-selection": "Graph selection",
    "search-result": "Search result",
    "validation-finding": "Validation finding",
    "profile-finding": "Profile finding",
    citation: "Citation",
    source: "Source",
    external: "External request",
    "intake-plan": "Intake plan",
  };
  return labels[origin.kind];
}
