import { describe, expect, it } from "vitest";
import {
  kickoffForOkfOrigin,
  tasksForOkfOrigin,
} from "@/features/agent/taskLauncher.ts";

describe("OKF task launcher", () => {
  it("offers repair only for a validation finding", () => {
    const conceptTasks = tasksForOkfOrigin({
      kind: "concept",
      id: "concept:features/agent-panel",
      title: "Agent Panel",
      conceptId: "features/agent-panel",
    });
    const findingTasks = tasksForOkfOrigin({
      kind: "validation-finding",
      id: "finding:1",
      title: "Agent Panel",
      issue: { level: "error", conceptId: "features/agent-panel", message: "Missing type" },
    });

    expect(conceptTasks).not.toContain("okf-repair");
    expect(findingTasks[0]).toBe("okf-repair");
  });

  it("carries a selected finding into the shared task kickoff", () => {
    const kickoff = kickoffForOkfOrigin("okf-repair", {
      kind: "validation-finding",
      id: "finding:1",
      title: "Agent Panel",
      issue: { level: "error", conceptId: "features/agent-panel", message: "Missing type" },
    });

    expect(kickoff.taskId).toBe("okf-repair");
    expect(kickoff.prompt).toContain("Missing type");
    expect(kickoff.sources).toEqual([
      expect.objectContaining({ content: "Missing type", origin: "features/agent-panel.md" }),
    ]);
  });

  it("turns advisory profile findings into reviewed migration work", () => {
    const origin = {
      kind: "profile-finding" as const,
      id: "profile:owner",
      title: "Name the responsible team.",
      conceptId: "features/agent-panel",
      diagnostic: {
        namespace: "com.example.knowledge",
        ruleId: "owner-present",
        level: "recommendation" as const,
        scope: "concept" as const,
        file: "features/agent-panel.md",
        conceptId: "features/agent-panel",
        field: "owner",
        message: "Name the responsible team.",
      },
    };

    expect(tasksForOkfOrigin(origin)).toEqual(["okf-migrate", "okf-revise", "okf-audit"]);
    const kickoff = kickoffForOkfOrigin("okf-migrate", origin);
    expect(kickoff.contextConceptIds).toEqual(["features/agent-panel"]);
    expect(kickoff.prompt).toContain("advisory profile finding");
    expect(kickoff.sources?.[0]?.content).toContain(
      "Basis: advisory profile, not OKF validation",
    );
  });

  it("does not attach a concept when profile advice targets the bundle", () => {
    const kickoff = kickoffForOkfOrigin("okf-migrate", {
      kind: "profile-finding",
      id: "profile:bundle",
      title: "Name the bundle owner.",
      conceptId: null,
      diagnostic: {
        namespace: "com.example.knowledge",
        ruleId: "bundle-owner",
        level: "recommendation",
        scope: "bundle",
        file: "index.md",
        conceptId: null,
        field: "owner",
        message: "Name the bundle owner.",
      },
    });

    expect(kickoff.contextConceptIds).toEqual([]);
  });

  it("hands an intake plan to the kickoff as sources plus a plan-derived prompt", () => {
    const plan = {
      schemaVersion: 1,
      planId: "a".repeat(64),
      sources: [
        {
          title: "report.pdf",
          mediaType: "application/pdf",
          pageCount: 3,
          sourceFingerprint: "sha256-a",
          refreshFingerprint: "sha256-refresh-a",
          warningCodes: [],
        },
      ],
      concepts: [
        { id: "c0", title: "Background", sourceTitle: "report.pdf", startPage: 1, startLine: 1, untilPage: 3, untilLine: 1, included: true },
        { id: "c1", title: "Disclosures", sourceTitle: "report.pdf", startPage: 3, startLine: 1, untilPage: 4, untilLine: 1, included: false },
      ],
      exclusions: [
        { sourceTitle: "report.pdf", kind: "furniture-running-line", text: "REVIEW THE DISCLOSURES.", occurrences: 3, reason: "Repeats 3 times across pages in a stable position." },
      ],
      evidence: [
        { sourceTitle: "report.pdf", marker: 3, text: "Datasource https://example.com (Date: 9/7/2021)", url: "https://example.com", statedDate: "9/7/2021", page: 3 },
      ],
      gaps: [
        { sourceTitle: "report.pdf", kind: "figure", caption: "FIGURE 2: DISTRIBUTION", page: 2 },
      ],
      omitted: 0,
    };
    const sources = [
      { title: "report.pdf", content: "## Page 1", mediaType: "application/pdf" },
    ];

    const kickoff = kickoffForOkfOrigin("okf-enrich", {
      kind: "intake-plan",
      id: plan.planId,
      title: "Intake plan of 1 document",
      plan,
      sources,
    });

    // The picked documents travel as the thread's sources, unchanged.
    expect(kickoff.sources).toEqual(sources);
    // The prompt is derived from the plan alone: kept concepts with spans,
    // furniture that must not travel, unverified evidence, named gaps.
    expect(kickoff.prompt).toContain('"Background" (report.pdf, pages 1-2)');
    expect(kickoff.prompt).not.toContain("Disclosures");
    expect(kickoff.prompt).toContain("never carry these lines into a concept");
    expect(kickoff.prompt).toContain("REVIEW THE DISCLOSURES.");
    expect(kickoff.prompt).toContain("treat each as unverified");
    expect(kickoff.prompt).toContain("none may be invented");
    expect(kickoff.prompt).toContain("FIGURE 2: DISTRIBUTION");
    expect(kickoff.prompt).toContain("Keep writes staged for review.");
  });

  it("offers enrichment first for an intake plan", () => {
    const tasks = tasksForOkfOrigin({
      kind: "intake-plan",
      id: "a".repeat(64),
      title: "Intake plan of 1 document",
      plan: {
        schemaVersion: 1,
        planId: "a".repeat(64),
        sources: [],
        concepts: [],
        exclusions: [],
        evidence: [],
        gaps: [],
        omitted: 0,
      },
      sources: [],
    });
    expect(tasks[0]).toBe("okf-enrich");
    expect(tasks).toContain("okf-create");
  });

  it("removes task entry points whose capability pack is inactive", () => {
    const origin = {
      kind: "concept" as const,
      id: "concept:overview",
      title: "Overview",
      conceptId: "overview",
    };

    expect(tasksForOkfOrigin(origin, new Set(["okf-audit", "okf-research"]))).toEqual([
      "okf-audit",
      "okf-research",
    ]);
    expect(tasksForOkfOrigin(origin, new Set(["okf-core"]))).toEqual([]);
  });
});
