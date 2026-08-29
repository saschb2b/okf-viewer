// IPC layer: the only place the frontend talks to the backend. In a Tauri
// window it calls Rust commands and plugins; in a browser or test it falls back
// to an in-memory mock, so the UI runs and tests pass without the backend.

import {
  acceptAgentEnvelope,
  emitAgentMilestone,
  onAgentMilestone,
  turnMilestoneFor,
  type AgentMilestone,
} from "./agentEvents.ts";
import type {
  AttestationReport,
  Bundle,
  BundleRoot,
  CompatibilityFinding,
  CompatibilityReport,
  IgnoreReport,
  ProfileReport,
  RecentBundle,
  RemoteSource,
  Settings,
} from "@/shared/types.ts";
import type {
  GitDiff,
  GitHistoryPage,
  GitRemoteOperation,
  GitRepositorySnapshot,
} from "@/features/git/types.ts";
import type {
  ProjectionExportInput,
  ProjectionExportResult,
  ProjectionInput,
  ProjectionPlan,
} from "@/features/bundle/projection.ts";
import type {
  InteropReport,
  SemanticImportPreview,
} from "@/features/bundle/interop.ts";
import { DEFAULT_SETTINGS } from "@/shared/types.ts";
import { assessAccessHints } from "@/shared/access.ts";
import { mockReceiptDiff, mockRetrieval } from "@/features/agent/retrieval/mockRetrieval.ts";
import { today } from "@/features/bundle/trust.ts";
import {
  inlineComputation,
  mockAttestationFor,
} from "@/features/bundle/mockAttestation.ts";
import { RECEIPT_FENCE } from "@/features/agent/receipt.ts";
import type { AgentReceiptValidation } from "@/features/agent/receipt.ts";
import type {
  ReceiptDiff,
  RetrievalRequest,
  RetrievalResult,
} from "@/features/agent/retrieval/types.ts";
import catalog from "@/features/agent/catalog.json";
import type { AgentBinaryTarget, AgentCatalogDocument } from "@/features/agent/catalog.ts";
import type { CustomAgentInput, CustomAgentProfile } from "@/features/agent/custom.ts";
import type {
  LocalModelProbe,
  LocalModelProfile,
  LocalModelProfileInput,
} from "@/features/agent/local.ts";
import type {
  AgentConnectionEvent,
  AgentCheckpointRestoreInfo,
  AgentConnectionInfo,
  AgentSecurityHostStatus,
  AgentSecurityScopeInfo,
  AgentConnectionMode,
  AgentAvailableCommandsEvent,
  AgentPermissionEvent,
  AgentLoadedSessionInfo,
  AgentSessionInfo,
  AgentSessionHistoryPage,
  AgentSessionConfigEvent,
  AgentSessionConfigOption,
  AgentSessionConfigSnapshot,
  AgentSessionConfigValueInput,
  AgentStagedApplyInfo,
  AgentStagedChangesInfo,
  AgentStagedCreateInfo,
  AgentStagedFileDiff,
  AgentStagedFileInfo,
  AgentStagedValidationInfo,
  AgentStageEvent,
  AgentTurnEvent,
  AgentTurnInfo,
} from "@/features/agent/connection.ts";
import type {
  AgentInstallPreflight,
  AgentInstallProgress,
  AgentInstallReceipt,
} from "@/features/agent/install.ts";
import {
  createAgentThreadMetadata,
  parseAgentThreadMetadata,
  removeAgentThreadMetadata as removeThreadMetadata,
  upsertAgentThreadMetadata,
  withThreadPrompt,
} from "@/features/agent/threadMetadata.ts";
import type {
  AgentThreadMetadata,
  AgentThreadPrompt,
} from "@/features/agent/threadMetadata.ts";
import {
  createOmissionPreference,
  createTaskRecord,
  memoryEnvelope,
  parseWorkspaceMemory,
  upsertWorkspaceMemory,
} from "@/features/agent/workspaceMemory.ts";
import type { WorkspaceMemoryItem } from "@/features/agent/workspaceMemory.ts";
import type { AcceptedOkfContextManifest, OkfTaskId } from "@/features/agent/taskContext.ts";
import type {
  AgentArtifactValidation,
  AgentCriticRequest,
  AgentCriticValidation,
} from "@/features/agent/artifact.ts";
import type {
  OkfRoutineDefinition,
  OkfRoutineRun,
  OkfRoutineWorkspace,
  SaveOkfRoutineInput,
} from "@/features/agent/routines.ts";
import type {
  BundleLibraryEntry,
  FederatedBundleSelection,
  FederatedBundleStatus,
  FederatedConceptPage,
  FederatedRelationshipPage,
  FederatedSourcePage,
} from "@/features/agent/federation.ts";
import { OKF_TASKS } from "@/features/agent/taskContext.ts";
import {
  MOCK_ASSETS,
  MOCK_BUNDLE,
  MOCK_FOLDER,
  MOCK_RECENTS,
  MOCK_ROOTS,
} from "@/mock/fixture.ts";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let MOCK_GIT_SNAPSHOT: GitRepositorySnapshot = {
  availability: "ready",
  message: null,
  repositoryName: "okf-studio",
  branch: "feat/integrated-git-support",
  upstream: "origin/feat/integrated-git-support",
  ahead: 2,
  behind: 0,
  headSha: "972bdb14a0b8468df0106f639691a24e0ba9ee31",
  changes: [
    {
      path: "docs/features/integrated-git.md",
      kind: "added",
      staged: true,
      unstaged: false,
    },
    {
      path: "src/features/git/components/GitPanel.tsx",
      kind: "modified",
      staged: false,
      unstaged: true,
    },
    {
      path: "notes/review.md",
      kind: "untracked",
      staged: false,
      unstaged: true,
    },
  ],
};

const MOCK_GIT_HISTORY: GitHistoryPage = {
  hasMore: false,
  commits: [
    {
      sha: "972bdb14a0b8468df0106f639691a24e0ba9ee31",
      shortSha: "972bdb1",
      subject: "Add bounded Git repository operations",
      authorName: "Sascha Becker",
      authorEmail: "sascha@example.invalid",
      timestamp: 1_774_110_000,
    },
    {
      sha: "610fb6aa3cfa8f7d69064cecd9bd25fa8f0c9124",
      shortSha: "610fb6a",
      subject: "Plan integrated Git support",
      authorName: "Sascha Becker",
      authorEmail: "sascha@example.invalid",
      timestamp: 1_774_106_400,
    },
  ],
};

const MOCK_GIT_DIFF: GitDiff = {
  title: "src/features/git/components/GitPanel.tsx",
  truncated: false,
  text: [
    "diff --git a/src/features/git/components/GitPanel.tsx b/src/features/git/components/GitPanel.tsx",
    "--- a/src/features/git/components/GitPanel.tsx",
    "+++ b/src/features/git/components/GitPanel.tsx",
    "@@ -1,3 +1,4 @@",
    " import { GitBranch } from \"lucide-react\";",
    "+import { GitChanges } from \"./GitChanges.tsx\";",
    " ",
    " export function GitPanel() {",
  ].join("\n"),
};

/** Keep browser demos legible without charging their presentation latency to tests. */
function browserMockDelay(milliseconds: number): Promise<void> {
  const delay = import.meta.env.MODE === "test" ? 0 : milliseconds;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Diagnostic sink: mirror a message to the host terminal (`pnpm tauri dev`).
 * Best-effort and fire-and-forget — the webview console is invisible there,
 * so crash forensics (uncaught errors, heap samples) also route through this.
 */
export function logToHost(message: string): void {
  console.warn(message);
  if (!isTauri()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("frontend_log", { message }))
    .catch(() => {
      /* diagnostics must never throw */
    });
}

export async function agentCatalog(): Promise<AgentCatalogDocument> {
  if (!isTauri()) return catalog as AgentCatalogDocument;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentCatalogDocument>("agent_catalog");
}

export type ExternalEntryAction = "open" | "inspect" | "validate" | "task";
export type ExternalEntrySource = "deepLink" | "cli";

export interface ExternalEntryPreview {
  requestId: string;
  source: ExternalEntrySource;
  action: ExternalEntryAction;
  bundleRoot: string;
  conceptId?: string;
  taskId?: OkfTaskId;
  promptDraft?: string;
  omittedFields: string[];
}

export interface OkfMcpLaunchGrant {
  command: string;
  args: string[];
  expiresAt: number;
}

export async function pendingExternalEntries(): Promise<ExternalEntryPreview[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ExternalEntryPreview[]>("pending_external_entries");
}

export async function acceptExternalEntry(
  requestId: string,
): Promise<ExternalEntryPreview | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ExternalEntryPreview | null>("accept_external_entry", { requestId });
}

export async function dismissExternalEntry(requestId: string): Promise<boolean> {
  if (!isTauri()) return true;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("dismiss_external_entry", { requestId });
}

export async function onExternalEntryRequested(
  handler: (entry: ExternalEntryPreview) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ExternalEntryPreview>("external-entry-requested", (event) => {
    handler(event.payload);
  });
}

export async function createOkfMcpGrant(bundleRoot: string): Promise<OkfMcpLaunchGrant> {
  if (!isTauri()) {
    return {
      command: "okf-studio",
      args: ["--okf-mcp-grant", "<one-shot-grant>", "<one-shot-token>"],
      expiresAt: Date.now() + 60_000,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OkfMcpLaunchGrant>("create_okf_mcp_grant", { bundleRoot });
}

const MOCK_OKF_ROUTINES_KEY = "okf-studio:routines-v1";
const MOCK_OKF_ROUTINE_RUNS_KEY = "okf-studio:routine-runs-v1";
const OKF_ROUTINES_CHANGED_EVENT = "okf:routines-changed";

function notifyOkfRoutinesChanged(): void {
  window.dispatchEvent(new Event(OKF_ROUTINES_CHANGED_EVENT));
}

export function onOkfRoutinesChange(listener: () => void): () => void {
  window.addEventListener(OKF_ROUTINES_CHANGED_EVENT, listener);
  return () => window.removeEventListener(OKF_ROUTINES_CHANGED_EVENT, listener);
}

function readMockRoutineValue<T>(key: string): T[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export async function okfRoutineWorkspace(bundleRoot: string): Promise<OkfRoutineWorkspace> {
  if (!isTauri()) {
    return {
      schemaVersion: 1,
      routines: readMockRoutineValue<OkfRoutineDefinition>(MOCK_OKF_ROUTINES_KEY)
        .filter((routine) => routine.scope.bundleRoot === bundleRoot),
      runs: readMockRoutineValue<OkfRoutineRun>(MOCK_OKF_ROUTINE_RUNS_KEY)
        .filter((run) => run.bundleRoot === bundleRoot),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OkfRoutineWorkspace>("okf_routine_workspace", { bundleRoot });
}

export async function saveOkfRoutine(input: SaveOkfRoutineInput): Promise<OkfRoutineDefinition> {
  if (!isTauri()) {
    const now = Date.now();
    const routine: OkfRoutineDefinition = {
      schemaVersion: 1,
      id: input.id ?? `routine-${crypto.randomUUID()}`,
      name: input.name,
      enabled: input.enabled,
      trigger: input.trigger,
      scope: input.scope,
      timeoutSeconds: input.timeoutSeconds,
      nextRunAtMs: input.enabled && input.trigger.mode === "scheduled"
        ? now + (input.trigger.intervalMinutes ?? 15) * 60_000
        : null,
      createdAtMs: now,
      updatedAtMs: now,
    };
    const routines = readMockRoutineValue<OkfRoutineDefinition>(MOCK_OKF_ROUTINES_KEY)
      .filter((item) => item.id !== routine.id);
    localStorage.setItem(MOCK_OKF_ROUTINES_KEY, JSON.stringify([...routines, routine]));
    notifyOkfRoutinesChanged();
    return routine;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const routine = await invoke<OkfRoutineDefinition>("save_okf_routine", { input });
  notifyOkfRoutinesChanged();
  return routine;
}

export async function removeOkfRoutine(routineId: string): Promise<boolean> {
  if (!isTauri()) {
    const routines = readMockRoutineValue<OkfRoutineDefinition>(MOCK_OKF_ROUTINES_KEY);
    localStorage.setItem(
      MOCK_OKF_ROUTINES_KEY,
      JSON.stringify(routines.filter((routine) => routine.id !== routineId)),
    );
    notifyOkfRoutinesChanged();
    return routines.some((routine) => routine.id === routineId);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const removed = await invoke<boolean>("remove_okf_routine", { routineId });
  if (removed) notifyOkfRoutinesChanged();
  return removed;
}

export async function runOkfRoutine(routineId: string): Promise<OkfRoutineRun> {
  if (!isTauri()) {
    const routine = readMockRoutineValue<OkfRoutineDefinition>(MOCK_OKF_ROUTINES_KEY)
      .find((item) => item.id === routineId);
    if (!routine) throw new Error("The routine no longer exists.");
    const now = Date.now();
    const run: OkfRoutineRun = {
      schemaVersion: 1,
      id: `run-${crypto.randomUUID()}`,
      routineId,
      routineName: routine.name,
      bundleRoot: routine.scope.bundleRoot,
      scheduledTimeMs: null,
      actualStartMs: now,
      completedAtMs: now,
      scopeFingerprint: "mock-offline-scope-v1",
      outcome: "healthy",
      recoveryState: "complete",
      reason: "No health findings detected.",
      nextAction: "None",
    };
    const runs = readMockRoutineValue<OkfRoutineRun>(MOCK_OKF_ROUTINE_RUNS_KEY);
    localStorage.setItem(MOCK_OKF_ROUTINE_RUNS_KEY, JSON.stringify([run, ...runs].slice(0, 512)));
    notifyOkfRoutinesChanged();
    return run;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const run = await invoke<OkfRoutineRun>("run_okf_routine", { routineId });
  notifyOkfRoutinesChanged();
  return run;
}

export async function runDueOkfRoutines(): Promise<OkfRoutineRun[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const runs = await invoke<OkfRoutineRun[]>("run_due_okf_routines");
  if (runs.length > 0) notifyOkfRoutinesChanged();
  return runs;
}

export type OkfCapabilityRiskClass = "read" | "analyze" | "fetch" | "stage";

export interface OkfCapabilityResourceInfo {
  id: string;
  label: string;
  path: string;
  mediaType: "text/markdown";
  sha256: string;
}

export interface OkfCapabilityInfo {
  id: string;
  version: string;
  description: string;
  riskClass: OkfCapabilityRiskClass;
  requiredTools: string[];
  artifactKinds: string[];
  resources: OkfCapabilityResourceInfo[];
}

export interface OkfCapabilityCatalogInfo {
  manifestSha256: string;
  schemaVersion: number;
  resourceSchemaVersion: number;
  pack: OkfCapabilityPackInfo;
  capabilities: OkfCapabilityInfo[];
}

export interface OkfCapabilityPackInfo {
  id: string;
  version: string;
  name: string;
  description: string;
  publisher: string;
  provenance: "built-in";
  manifestSha256: string;
  compatibility: {
    minimumStudioVersion: string;
    capabilitySchemaVersion: number;
    artifactSchemaVersion: number;
  };
  conflicts: string[];
  requiredStudioTools: string[];
  templateIds: string[];
  artifactSchemaIds: string[];
  active: boolean;
  rollbackLabel: string;
}

const MOCK_OKF_CAPABILITY_IDS = [
  "okf-core",
  "okf-inspect",
  "okf-retrieve",
  "okf-create",
  "okf-enrich",
  "okf-audit",
  "okf-repair",
  "okf-research",
  "okf-change-impact",
  "okf-migrate",
  "okf-author",
  "okf-revise",
] as const;

const MOCK_OKF_CAPABILITY_RISKS: Record<(typeof MOCK_OKF_CAPABILITY_IDS)[number], OkfCapabilityRiskClass> = {
  "okf-core": "stage",
  "okf-inspect": "read",
  "okf-retrieve": "analyze",
  "okf-create": "analyze",
  "okf-enrich": "stage",
  "okf-audit": "analyze",
  "okf-repair": "stage",
  "okf-research": "fetch",
  "okf-change-impact": "analyze",
  "okf-migrate": "analyze",
  "okf-author": "stage",
  "okf-revise": "stage",
};

const MOCK_OKF_CAPABILITY_VERSIONS: Record<(typeof MOCK_OKF_CAPABILITY_IDS)[number], string> = {
  "okf-core": "0.6.0",
  "okf-inspect": "0.3.0",
  "okf-retrieve": "0.1.1",
  "okf-create": "0.3.0",
  "okf-enrich": "0.2.0",
  "okf-audit": "0.3.0",
  "okf-repair": "0.3.0",
  "okf-research": "0.3.0",
  "okf-change-impact": "0.3.0",
  "okf-migrate": "0.2.0",
  "okf-author": "0.1.0",
  "okf-revise": "0.1.0",
};

const MOCK_OKF_CAPABILITY_ARTIFACTS: Record<(typeof MOCK_OKF_CAPABILITY_IDS)[number], string[]> = {
  "okf-core": ["source-inventory", "bundle-plan", "health-report", "research-brief", "change-impact-map", "migration-plan", "writing-revision", "staged-revision"],
  "okf-inspect": ["health-report"],
  "okf-retrieve": ["health-report", "research-brief"],
  "okf-create": ["source-inventory", "bundle-plan"],
  "okf-enrich": ["source-inventory", "staged-revision"],
  "okf-audit": ["health-report"],
  "okf-repair": ["staged-revision"],
  "okf-research": ["source-inventory", "research-brief"],
  "okf-change-impact": ["change-impact-map"],
  "okf-migrate": ["migration-plan"],
  "okf-author": ["writing-revision", "staged-revision"],
  "okf-revise": ["writing-revision", "staged-revision"],
};

const MOCK_OKF_CAPABILITY_TOOLS: Record<(typeof MOCK_OKF_CAPABILITY_IDS)[number], string[]> = {
  "okf-core": ["okf_inventory", "okf_read", "okf_search", "okf_retrieve", "okf_sources", "okf_traverse", "okf_validate", "okf_health_summary", "okf_health_finding", "okf_health_affected", "okf_health_repair"],
  "okf-inspect": ["okf_health_summary", "okf_inventory", "okf_search", "okf_retrieve", "okf_read", "okf_traverse"],
  "okf-retrieve": ["okf_retrieve", "okf_read"],
  "okf-create": ["okf_health_summary", "okf_inventory", "okf_read", "okf_traverse"],
  "okf-enrich": ["okf_health_summary", "okf_search", "okf_read", "okf_sources", "studio_stage_propose", "studio_stage_validate"],
  "okf-audit": ["okf_inventory", "okf_validate", "okf_health_summary", "okf_health_finding", "okf_health_affected", "okf_health_repair", "okf_read"],
  "okf-repair": ["okf_inventory", "okf_validate", "okf_health_summary", "okf_health_finding", "okf_health_repair", "okf_read", "studio_stage_propose", "studio_stage_validate"],
  "okf-research": ["okf_health_summary", "okf_inventory", "okf_search", "okf_retrieve", "okf_read", "okf_sources"],
  "okf-change-impact": ["okf_health_summary", "okf_search", "okf_retrieve", "okf_read", "okf_traverse"],
  "okf-migrate": ["okf_health_summary", "okf_inventory", "okf_search", "okf_traverse"],
  "okf-author": ["okf_health_summary", "okf_read", "okf_sources", "studio_stage_propose", "studio_stage_validate"],
  "okf-revise": ["okf_health_summary", "okf_read", "studio_stage_propose", "studio_stage_validate"],
};

function mockCapability(id: (typeof MOCK_OKF_CAPABILITY_IDS)[number]): OkfCapabilityInfo {
  const name = id.replace("okf-", "");
  return {
    id,
    version: MOCK_OKF_CAPABILITY_VERSIONS[id],
    description: id === "okf-core"
      ? "Shared OKF specification, commands, templates, and invariant guidance."
      : `Built-in ${name} method for bounded OKF work.`,
    riskClass: MOCK_OKF_CAPABILITY_RISKS[id],
    requiredTools: MOCK_OKF_CAPABILITY_TOOLS[id],
    artifactKinds: MOCK_OKF_CAPABILITY_ARTIFACTS[id],
    resources: [{
      id: "instructions",
      label: `${name} instructions`,
      path: id === "okf-core" ? "SKILL.md" : `capabilities/${name}.md`,
      mediaType: "text/markdown",
      sha256: "browser-preview",
    }],
  };
}

export async function okfCapabilityCatalog(): Promise<OkfCapabilityCatalogInfo> {
  if (!isTauri()) {
    return {
      manifestSha256: "browser-preview",
      schemaVersion: 1,
      resourceSchemaVersion: 1,
      pack: mockCapabilityPackInfo(true),
      capabilities: MOCK_OKF_CAPABILITY_IDS.map(mockCapability),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OkfCapabilityCatalogInfo>("okf_capability_catalog");
}

export async function setOkfCapabilityPackActive(active: boolean): Promise<OkfCapabilityCatalogInfo> {
  if (!isTauri()) {
    const catalog: OkfCapabilityCatalogInfo = {
      manifestSha256: "browser-preview",
      schemaVersion: 1,
      resourceSchemaVersion: 1,
      pack: mockCapabilityPackInfo(active),
      capabilities: active
        ? MOCK_OKF_CAPABILITY_IDS.map(mockCapability)
        : [mockCapability("okf-core")],
    };
    window.dispatchEvent(new CustomEvent("okf-capability-pack-changed", { detail: catalog }));
    return catalog;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OkfCapabilityCatalogInfo>("set_okf_capability_pack_active", { active });
}

export async function onOkfCapabilityPackChanged(
  handler: (catalog: OkfCapabilityCatalogInfo) => void,
): Promise<() => void> {
  if (!isTauri()) {
    const listener = (event: Event) => handler((event as CustomEvent<OkfCapabilityCatalogInfo>).detail);
    window.addEventListener("okf-capability-pack-changed", listener);
    return () => window.removeEventListener("okf-capability-pack-changed", listener);
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<OkfCapabilityCatalogInfo>("okf-capability-pack-changed", (event) => {
    handler(event.payload);
  });
}

function mockCapabilityPackInfo(active: boolean): OkfCapabilityPackInfo {
  return {
    id: "okf-foundation",
    version: "1.3.1",
    name: "OKF Foundation",
    description: "The built-in declarative skills, templates, artifact contract, and Studio tool requirements for bounded OKF work.",
    publisher: "OKF Studio",
    provenance: "built-in",
    manifestSha256: "browser-preview",
    compatibility: {
      minimumStudioVersion: "0.3.0",
      capabilitySchemaVersion: 1,
      artifactSchemaVersion: 1,
    },
    conflicts: [],
    requiredStudioTools: [
      "okf_capability_catalog",
      "okf_capability_resource",
      ...new Set(MOCK_OKF_CAPABILITY_IDS.flatMap((id) => MOCK_OKF_CAPABILITY_TOOLS[id])),
    ],
    templateIds: ["okf-markdown-templates"],
    artifactSchemaIds: ["okf-artifact-v1", "writing-revision-v1"],
    active,
    rollbackLabel: "Legacy 0.4.0",
  };
}

export async function validateAgentArtifact(
  root: string,
  markdown: string,
): Promise<AgentArtifactValidation> {
  if (!isTauri()) {
    return markdown.includes("```okf-artifact")
      ? {
          status: "invalid",
          message: "The desktop host is required to validate structured artifacts.",
        }
      : { status: "none" };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentArtifactValidation>("validate_agent_artifact", { root, markdown });
}

/** The `okf-receipt` fence body, matching agent_receipt.rs's extraction. */
function receiptFenceJson(markdown: string): string | null {
  const marker = markdown.lastIndexOf(RECEIPT_FENCE);
  if (marker === -1) return null;
  const afterMarker = marker + RECEIPT_FENCE.length;
  const contentStart = markdown.indexOf("\n", afterMarker);
  if (contentStart === -1) return null;
  const end = markdown.indexOf("\n```", contentStart + 1);
  if (end === -1) return null;
  return markdown.slice(contentStart + 1, end).trim();
}

/** Mirrors agent_receipt::validate, including which shapes it refuses. */
function mockReceiptValidation(markdown: string, on: string): AgentReceiptValidation {
  const json = receiptFenceJson(markdown);
  if (json === null) return { status: "none" };

  // Parsed as `unknown` and narrowed, rather than assigned straight into a
  // shape it has not been checked against. This is agent-supplied input on the
  // authority path, so taking `JSON.parse`'s `any` at its word is exactly the
  // wrong move here.
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { status: "invalid", message: `The receipt JSON is invalid: ${String(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", message: "A receipt envelope is a JSON object." };
  }
  const envelope = parsed as { schemaVersion?: number; conceptId?: string; receipt?: unknown };
  if (envelope.schemaVersion !== 1) {
    return { status: "invalid", message: "Receipt schemaVersion must be 1." };
  }
  const conceptId = envelope.conceptId?.trim();
  if (!conceptId) return { status: "invalid", message: "The receipt names no usable concept." };

  // Looked up in the bundle, never taken from the envelope. An agent that could
  // supply the computation it is judged against could always pass.
  const concept = MOCK_BUNDLE.concepts.find((item) => item.id === conceptId);
  if (!concept) {
    return {
      status: "invalid",
      message: `This bundle has no concept ${conceptId}, so there is no contract to check the run against.`,
    };
  }

  const fields = envelope.receipt;
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return { status: "invalid", message: "That receipt carries no usable fields." };
  }
  const receipt: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      return {
        status: "invalid",
        message: `Receipt field ${name} is not a single value, so there is nothing to compare.`,
      };
    }
    receipt[name] = String(value);
  }
  if (Object.keys(receipt).length === 0) {
    return { status: "invalid", message: "That receipt carries no usable fields." };
  }

  const path = concept.computation?.computation ?? null;
  const stored = path
    ? MOCK_ASSETS[path.replace(/^\/+/, "")] ?? null
    : inlineComputation(concept.body);
  return {
    status: "checked",
    report: mockAttestationFor(concept, stored, path, receipt, on),
  };
}

/**
 * Check an `okf-receipt` fence in agent output against the bundle's contract.
 *
 * The browser stand-in performs the real check rather than refusing, unlike the
 * artifact validator: this is a gate, and a stand-in that answered "cannot
 * check here" would make every test of the gate a test of nothing.
 */
export async function validateAgentReceipt(
  root: string,
  markdown: string,
  on = today(),
): Promise<AgentReceiptValidation> {
  if (!isTauri()) return mockReceiptValidation(markdown, on);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentReceiptValidation>("validate_agent_receipt", {
    root,
    markdown,
    today: on,
  });
}

export async function prepareAgentArtifactCritic(
  root: string,
  artifactMarkdown: string,
): Promise<AgentCriticRequest> {
  if (!isTauri()) {
    throw new Error("The desktop host is required to prepare an isolated critic pass.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentCriticRequest>("prepare_agent_artifact_critic", {
    root,
    artifactMarkdown,
  });
}

export async function validateAgentArtifactCritic(
  root: string,
  artifactMarkdown: string,
  criticMarkdown: string,
): Promise<AgentCriticValidation> {
  if (!isTauri()) {
    return {
      status: "invalid",
      message: "The desktop host is required to validate critic output.",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentCriticValidation>("validate_agent_artifact_critic", {
    root,
    artifactMarkdown,
    criticMarkdown,
  });
}

function browserSecurityPlatform(): AgentSecurityHostStatus["platform"] {
  if (navigator.userAgent.includes("Windows")) return "windows";
  if (navigator.userAgent.includes("Mac")) return "macos";
  if (navigator.userAgent.includes("Linux")) return "linux";
  return "other";
}

export async function agentSecurityHostStatus(): Promise<AgentSecurityHostStatus> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSecurityHostStatus>("agent_security_host_status");
  }
  return {
    platform: browserSecurityPlatform(),
    backend: null,
    state: "unsupported-platform",
    launchProfileAvailable: false,
  };
}

let mockCustomAgents: CustomAgentProfile[] = [];
let mockLocalModelProfiles: LocalModelProfile[] = [];
const activeAgentConnectionsById = new Map<string, AgentConnectionInfo>();
let activeAgentConnectionSnapshot: readonly AgentConnectionInfo[] = [];
const activeAgentConnectionSubscribers = new Set<() => void>();
type AgentConnectionHandler = (event: AgentConnectionEvent) => void;
const agentConnectionHandlers = new Set<AgentConnectionHandler>();
let agentConnectionListener: Promise<() => void> | undefined;
type AgentTurnHandler = (event: AgentTurnEvent) => void;
const agentTurnHandlers = new Set<AgentTurnHandler>();
type AgentPermissionHandler = (event: AgentPermissionEvent) => void;
const agentPermissionHandlers = new Set<AgentPermissionHandler>();
type AgentStageHandler = (event: AgentStageEvent) => void;
const agentStageHandlers = new Set<AgentStageHandler>();
type AgentSessionConfigHandler = (event: AgentSessionConfigEvent) => void;
const agentSessionConfigHandlers = new Set<AgentSessionConfigHandler>();
type AgentAvailableCommandsHandler = (event: AgentAvailableCommandsEvent) => void;
const agentAvailableCommandsHandlers = new Set<AgentAvailableCommandsHandler>();
type MockStagedFile = AgentStagedFileInfo & {
  content: string;
  hunkSelected: boolean;
  hunkReviewed: boolean;
};
const mockStagedChanges = new Map<
  string,
  {
    granted: boolean;
    grantMode: "interactive" | "unattended" | null;
    mode: "edit" | "enhance" | "create";
    canRestore: boolean;
    files: MockStagedFile[];
  }
>();
const mockBundleCheckpoints = new Map<string, number>();
const mockCancelledTurns = new Set<string>();
const mockFailedOncePrompts = new Set<string>();
interface MockAgentSession {
  profileId: string;
  bundleRoot: string;
  title: string;
  updatedAt: string;
  messages: AgentLoadedSessionInfo["messages"];
  configOptions: readonly AgentSessionConfigOption[];
}
const mockAgentSessions = new Map<string, MockAgentSession>();
const mockPermissionResponses = new Map<
  string,
  {
    turnId: string;
    optionIds: ReadonlySet<string>;
    optionDecisions: ReadonlyMap<string, "allow" | "reject">;
    ruleKey: string;
    resolve: (optionId: string | null) => void;
  }
>();
const mockThreadPermissionRules = new Map<string, "allow" | "reject">();

function clearMockThreadPermissionRules(connectionId: string, sessionId?: string): void {
  const prefix = sessionId === undefined
    ? `${connectionId}\0`
    : `${connectionId}\0${sessionId}\0`;
  for (const key of mockThreadPermissionRules.keys()) {
    if (key.startsWith(prefix)) mockThreadPermissionRules.delete(key);
  }
}

export async function customAgents(): Promise<readonly CustomAgentProfile[]> {
  if (!isTauri()) return mockCustomAgents;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CustomAgentProfile[]>("custom_agents");
}

export async function saveCustomAgent(
  input: CustomAgentInput,
): Promise<CustomAgentProfile> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<CustomAgentProfile>("save_custom_agent", { input });
  }
  const profile = { ...input, id: `custom-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}` };
  mockCustomAgents = [...mockCustomAgents, profile];
  return profile;
}

export async function removeCustomAgent(profileId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const removed = await invoke<boolean>("remove_custom_agent", { profileId });
    if (removed) forgetProfileConnections(profileId);
    return removed;
  }
  for (const [connectionId, info] of activeAgentConnectionsById) {
    if (info.profileId !== profileId) continue;
    activeAgentConnectionsById.delete(connectionId);
    emitMockAgentConnection({
      connectionId,
      profileId,
      status: "disconnected",
      message: null,
    });
  }
  const previousLength = mockCustomAgents.length;
  mockCustomAgents = mockCustomAgents.filter((profile) => profile.id !== profileId);
  for (const [sessionId, session] of mockAgentSessions) {
    if (session.profileId === profileId) mockAgentSessions.delete(sessionId);
  }
  return mockCustomAgents.length !== previousLength;
}

export async function localModelProfiles(): Promise<readonly LocalModelProfile[]> {
  if (!isTauri()) return mockLocalModelProfiles;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LocalModelProfile[]>("local_model_profiles");
}

export async function saveLocalModelProfile(
  input: LocalModelProfileInput,
): Promise<LocalModelProfile> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LocalModelProfile>("save_local_model_profile", { input });
  }
  const duplicate = mockLocalModelProfiles.some(
    (profile) => profile.provider === input.provider && profile.baseUrl === input.baseUrl,
  );
  if (duplicate) throw new Error("That provider endpoint is already configured.");
  const profile = {
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    id: `local-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    hasCredential: Boolean(input.apiKey?.trim()),
  };
  mockLocalModelProfiles = [...mockLocalModelProfiles, profile];
  return profile;
}

export async function removeLocalModelProfile(profileId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("remove_local_model_profile", { profileId });
  }
  const previousLength = mockLocalModelProfiles.length;
  mockLocalModelProfiles = mockLocalModelProfiles.filter(
    (profile) => profile.id !== profileId,
  );
  forgetProfileConnections(profileId);
  return mockLocalModelProfiles.length !== previousLength;
}

export async function testLocalModelEndpoint(
  input: LocalModelProfileInput,
): Promise<LocalModelProbe> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LocalModelProbe>("test_local_model_endpoint", { input });
  }
  await browserMockDelay(80);
  if (input.apiKey !== undefined && input.apiKey.trim() !== "") {
    const apiKey = input.apiKey.trim();
    if (input.provider !== "open-ai-compatible") {
      throw new Error("API keys are available only for OpenAI-compatible endpoints.");
    }
    if (apiKey.length > 4096 || !/^[\x21-\x7E]+$/u.test(apiKey)) {
      throw new Error("API keys must contain 1 to 4,096 visible ASCII characters.");
    }
    const endpoint = new URL(input.baseUrl);
    const loopback = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" ||
      endpoint.hostname === "[::1]";
    if (endpoint.protocol !== "https:" && !loopback) {
      throw new Error("API-key endpoints must use HTTPS unless they are on localhost.");
    }
  }
  if (input.baseUrl.includes("unreachable")) {
    throw new Error("Studio could not reach the endpoint. Check that its server is running.");
  }
  return {
    provider: input.provider,
    baseUrl: input.baseUrl,
    models:
      input.provider === "ollama"
        ? ["qwen3:8b", "gemma3:4b"]
        : ["local-instruct", "local-tool-model"],
  };
}

export async function testSavedLocalModelEndpoint(
  profileId: string,
): Promise<LocalModelProbe> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<LocalModelProbe>("test_saved_local_model_endpoint", { profileId });
  }
  const profile = mockLocalModelProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("The Studio model profile was not found.");
  return testLocalModelEndpoint(profile);
}

function mockExternalSecurityScope(): AgentSecurityScopeInfo {
  return {
    evidenceSource: "external-process-launcher",
    processContainment: navigator.userAgent.includes("Windows")
      ? "windows-job-object"
      : "posix-process-group",
    profile: {
      id: "external-interactive-unrestricted-v1",
      effectiveMounts: "host-operating-system",
      writableRoots: "host-operating-system-permissions",
      networkPolicy: "host-operating-system",
      credentialExposure: "host-operating-system-and-launch-environment",
      lifetime: "connection",
      stopConditions: ["disconnect", "application-exit", "host-failure"],
      unattendedEligible: false,
    },
  };
}

function mockNativeSecurityScope(): AgentSecurityScopeInfo {
  return {
    evidenceSource: "native-provider-host",
    processContainment: "in-process",
    profile: {
      id: "studio-native-mediated-v1",
      effectiveMounts: "studio-tool-mediated-bundle",
      writableRoots: "reviewed-staging-only",
      networkPolicy: "configured-endpoint-only",
      credentialExposure: "configured-endpoint-only",
      lifetime: "connection",
      stopConditions: ["disconnect", "application-exit", "host-failure"],
      unattendedEligible: false,
    },
  };
}

// --- Last explicit agent connection, remembered so the panel can restore it
// --- on the next launch. Connecting saves it; explicit disconnect forgets it.

export interface LastAgentConnection {
  kind: "catalog" | "custom" | "local";
  id: string;
  mode?: AgentConnectionMode;
  model?: string;
  /**
   * The auth method that last authenticated this profile. ACP agents own their
   * own credentials — Zed's docs are explicit that "External Agent usually owns
   * its own runtime, auth, model selection, tools" — so calling `authenticate`
   * again with the same method is normally a non-interactive no-op against an
   * agent that is already signed in. Without remembering it, a restored
   * connection came back unauthenticated and the panel asked which method to
   * use on every single launch, blocking the saved thread behind a choice the
   * user had already made.
   */
  authMethodId?: string;
  /**
   * What to call this agent when restore fails. The id is not presentable, and
   * looking the name up is unreliable at exactly the moment it is needed: a
   * restore fails because the install, profile, or endpoint went away, which is
   * also when the catalog or profile list no longer has an entry to read a name
   * from. So the name is recorded while the connection is up.
   */
  name?: string;
}

const LAST_CONNECTION_KEY = "okf-studio:agent-last-connection";

function lastConnectionProfileId(entry: LastAgentConnection): string {
  return entry.kind === "catalog" ? `catalog-${entry.id}` : entry.id;
}

/**
 * The auth method remembered for a profile, if any. The picker leads with it and
 * says the credential expired, rather than presenting a first-run choice for a
 * decision the user already made.
 */
export function rememberedAuthMethod(profileId: string): string | null {
  const last = lastAgentConnection();
  if (!last || lastConnectionProfileId(last) !== profileId) return null;
  return last.authMethodId ?? null;
}

export function lastAgentConnection(): LastAgentConnection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_CONNECTION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<LastAgentConnection>;
    if (
      (stored.kind !== "catalog" && stored.kind !== "custom" && stored.kind !== "local") ||
      typeof stored.id !== "string" || stored.id.length === 0 || stored.id.length > 128
    ) {
      return null;
    }
    return {
      kind: stored.kind,
      id: stored.id,
      mode: stored.mode === "restricted-offline" ? "restricted-offline" : undefined,
      model:
        typeof stored.model === "string" && stored.model.length > 0 && stored.model.length <= 256
          ? stored.model
          : undefined,
      authMethodId:
        typeof stored.authMethodId === "string" &&
        stored.authMethodId.length > 0 &&
        stored.authMethodId.length <= 128
          ? stored.authMethodId
          : undefined,
      name:
        typeof stored.name === "string" && stored.name.length > 0 && stored.name.length <= 128
          ? stored.name
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The name to remember an agent by. An ACP agent may report neither a title nor
 * a name, so this can be absent — the failure state falls back to unnamed copy
 * rather than showing an empty phrase.
 */
function rememberableName(info: AgentConnectionInfo): string | undefined {
  return info.agent?.title ?? info.agent?.name ?? undefined;
}

function saveLastAgentConnection(entry: LastAgentConnection): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_CONNECTION_KEY, JSON.stringify(entry));
  } catch {
    // Restore is a convenience; a blocked storage API must not block connecting.
  }
}

/**
 * Note the method that just authenticated `profileId`, if that profile is the
 * remembered one. Kept separate from saveLastAgentConnection so authenticating
 * never rewrites the connection kind, mode, or model.
 */
function rememberAuthMethod(profileId: string, methodId: string): void {
  const last = lastAgentConnection();
  if (!last || lastConnectionProfileId(last) !== profileId) return;
  if (last.authMethodId === methodId) return;
  saveLastAgentConnection({ ...last, authMethodId: methodId });
}

function forgetLastAgentConnection(profileId: string): void {
  const last = lastAgentConnection();
  if (!last || lastConnectionProfileId(last) !== profileId) return;
  try {
    localStorage.removeItem(LAST_CONNECTION_KEY);
  } catch {
    // Restore is a convenience; a blocked storage API must not block disconnecting.
  }
}

/**
 * Reconnect the most recent explicitly connected agent, if one is remembered,
 * and re-apply the auth method it was signed in with.
 *
 * Reconnecting alone is not enough. A fresh ACP connection reports
 * `authenticated: false` and re-advertises its methods, and the conversation
 * surface gates its draft session, its saved-thread resume, and its session load
 * on that flag — so without re-applying the method, the panel asks which one to
 * use on every launch and the previous thread sits behind a choice the user has
 * already made. The agent itself holds the credentials, so `authenticate` with
 * the remembered method is normally a non-interactive no-op; it is the same call
 * the user would otherwise make by hand. If it fails the connection stays up and
 * the picker appears, which is where an expired or revoked credential should
 * surface.
 */
async function restoreLastAgentConnection(
  bundleRoot: string,
): Promise<AgentConnectionInfo | null> {
  const last = lastAgentConnection();
  if (!last) return null;
  // Set before connecting, because the connection is published from inside the
  // connect call and a subscriber acts on it immediately.
  markNextConnectionRestored = true;
  let info: AgentConnectionInfo | null;
  try {
    info = await connectRememberedAgent(last, bundleRoot);
  } finally {
    markNextConnectionRestored = false;
  }
  // A remembered entry that cannot even be turned into a connection attempt is
  // a failed restore, not a quiet no-op: resolving with null would drop the user
  // on the first-run empty state with no hint that an agent was meant to return.
  if (!info) throw new Error("The remembered agent could not be reconnected.");
  // Authenticating happens after the connection is already marked and published,
  // so however long it takes, the first conversation surface can still tell this
  // was a launch restore and continue the saved thread rather than offering a
  // Resume card.
  return reauthenticateRestored(info, last.authMethodId);
}

function connectRememberedAgent(
  last: LastAgentConnection,
  bundleRoot: string,
): Promise<AgentConnectionInfo | null> {
  if (last.kind === "catalog") return connectCatalogAgent(last.id, bundleRoot);
  if (last.kind === "custom") {
    return connectCustomAgent(last.id, bundleRoot, last.mode ?? "standard");
  }
  if (!last.model) return Promise.resolve(null);
  return connectLocalModel(last.id, last.model);
}

/** Re-apply a remembered method, returning the connection either way. */
async function reauthenticateRestored(
  info: AgentConnectionInfo,
  methodId: string | undefined,
): Promise<AgentConnectionInfo> {
  if (info.authenticated || !methodId) return info;
  if (!info.authMethods.some((method) => method.id === methodId)) return info;
  try {
    await authenticateAgent(info.connectionId, methodId);
  } catch {
    // An expired credential is not a restore failure: the connection is up, and
    // the picker is the right place to say so.
  }
  return activeAgentConnectionsById.get(info.connectionId) ?? info;
}

/**
 * Publish a new connection, marking it as a launch restore before any subscriber
 * can see it.
 *
 * The marker has to be set here rather than around the connect call: a
 * subscriber learns about the connection synchronously, mounts a conversation
 * surface, and that surface asks whether this was a launch restore as soon as it
 * finishes loading its saved-thread metadata. Marking any later leaves a window
 * where the answer depends on which store read finished first, so the thread
 * auto-resumes or offers a Resume card depending on disk timing.
 */
function registerAgentConnection(info: AgentConnectionInfo): void {
  activeAgentConnectionsById.set(info.connectionId, info);
  if (markNextConnectionRestored) {
    markNextConnectionRestored = false;
    restoredConnectionIds.add(info.connectionId);
  }
  publishAgentConnections();
}

export type AgentRestoreStatus = "idle" | "restoring" | "failed";

let agentRestoreState: AgentRestoreStatus = "idle";
let agentRestoreAttempted = false;
let markNextConnectionRestored = false;
const agentRestoreSubscribers = new Set<() => void>();
const restoredConnectionIds = new Set<string>();

/** Reset every mutable browser-mock boundary so a failed test cannot poison the next one. */
export function resetBrowserMockForTests(): void {
  for (const pending of mockPermissionResponses.values()) pending.resolve(null);

  mockCustomAgents = [];
  mockLocalModelProfiles = [];
  activeAgentConnectionsById.clear();
  activeAgentConnectionSnapshot = [];
  activeAgentConnectionSubscribers.clear();
  agentConnectionHandlers.clear();
  agentTurnHandlers.clear();
  agentPermissionHandlers.clear();
  agentStageHandlers.clear();
  agentSessionConfigHandlers.clear();
  agentAvailableCommandsHandlers.clear();
  mockStagedChanges.clear();
  mockBundleCheckpoints.clear();
  mockCancelledTurns.clear();
  mockFailedOncePrompts.clear();
  mockAgentSessions.clear();
  mockPermissionResponses.clear();
  mockThreadPermissionRules.clear();
  agentRestoreState = "idle";
  agentRestoreAttempted = false;
  agentRestoreSubscribers.clear();
  restoredConnectionIds.clear();
  mockInstallProgressHandlers.clear();
  mockCancelledInstalls.clear();
  mockInstalledAgents.clear();
  mockRecents = null;
}

/**
 * Whether this connection was just restored at launch. Consuming it lets the
 * first conversation surface resume the saved thread automatically, exactly
 * once — a user-created surface or reconnect keeps its explicit choice.
 */
export function consumeRestoredConnection(connectionId: string): boolean {
  return restoredConnectionIds.delete(connectionId);
}

function publishAgentRestoreState(next: AgentRestoreStatus): void {
  agentRestoreState = next;
  for (const subscriber of agentRestoreSubscribers) subscriber();
}

export function agentRestoreStatus(): AgentRestoreStatus {
  return agentRestoreState;
}

export function subscribeAgentRestore(subscriber: () => void): () => void {
  agentRestoreSubscribers.add(subscriber);
  return () => agentRestoreSubscribers.delete(subscriber);
}

/**
 * Restore the remembered connection once per app session, the first time the
 * panel is open beside a bundle. An explicit Disconnect already forgot the
 * entry, so this only continues a connection the user chose to keep.
 */
export function maybeRestoreLastAgentConnection(bundleRoot: string): void {
  if (agentRestoreAttempted) return;
  agentRestoreAttempted = true;
  if (activeAgentConnectionSnapshot.length > 0 || !lastAgentConnection()) return;
  runRestore(bundleRoot);
}

/**
 * Try the remembered connection again after a failure. A restore fails for
 * reasons that are often transient or fixable without leaving Studio — an agent
 * still installing, a local endpoint not up yet, a network blip — so the retry
 * does not cost the user a second trip through the catalog.
 */
export function retryRestoreLastAgentConnection(bundleRoot: string): void {
  if (agentRestoreState === "restoring") return;
  if (activeAgentConnectionSnapshot.length > 0 || !lastAgentConnection()) return;
  runRestore(bundleRoot);
}

function runRestore(bundleRoot: string): void {
  publishAgentRestoreState("restoring");
  restoreLastAgentConnection(bundleRoot).then(
    () => publishAgentRestoreState("idle"),
    () => publishAgentRestoreState("failed"),
  );
}

/**
 * The remembered agent's display name, for a restore failure that has to say
 * which agent it is talking about. Null when nothing is remembered, or when the
 * entry predates the name being recorded.
 */
export function rememberedAgentName(): string | null {
  return lastAgentConnection()?.name ?? null;
}

export async function connectCustomAgent(
  profileId: string,
  bundleRoot: string,
  mode: AgentConnectionMode = "standard",
): Promise<AgentConnectionInfo> {
  const remember = (info: AgentConnectionInfo) => saveLastAgentConnection({
    kind: "custom",
    id: profileId,
    mode: mode === "restricted-offline" ? mode : undefined,
    name: rememberableName(info),
  });
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<AgentConnectionInfo>("connect_custom_agent", {
      profileId,
      bundleRoot,
      mode,
    });
    registerAgentConnection(info);
    remember(info);
    return info;
  }
  const profile = mockCustomAgents.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("Custom agent profile was not found.");
  if (mode === "restricted-offline") {
    throw new Error("Restricted offline connections require the desktop Linux app.");
  }
  await browserMockDelay(80);
  const info: AgentConnectionInfo = {
    connectionId: `connection-${crypto.randomUUID()}`,
    profileId,
    bundleRoot,
    protocolVersion: "1",
    agent: { name: "browser-acp", title: profile.name, version: "0.0.0-dev" },
    authMethods: profile.name.includes("Auth")
      ? [{ id: "browser-login", name: "Sign in with browser", description: "The agent opens its own sign-in flow." }]
      : [],
    authenticated: !profile.name.includes("Auth"),
    capabilities: {
      loadSession: true,
      promptImage: true,
      promptAudio: false,
      promptEmbeddedContext: false,
      mcpHttp: false,
      mcpSse: false,
      sessionList: true,
      sessionResume: false,
      sessionClose: false,
    },
    securityScope: mockExternalSecurityScope(),
  };
  registerAgentConnection(info);
  remember(info);
  return info;
}

export async function connectCatalogAgent(
  agentId: string,
  bundleRoot: string,
): Promise<AgentConnectionInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<AgentConnectionInfo>("connect_catalog_agent", {
      agentId,
      bundleRoot,
    });
    registerAgentConnection(info);
    saveLastAgentConnection({ kind: "catalog", id: agentId, name: rememberableName(info) });
    return info;
  }
  if (!mockInstalledAgents.has(agentId)) throw new Error("Install this agent before connecting it.");
  const entry = (catalog as AgentCatalogDocument).entries.find(
    (candidate) => candidate.id === agentId,
  );
  if (!entry?.distribution) throw new Error("This agent is not installable yet.");
  await browserMockDelay(80);
  const profileId = `catalog-${agentId}`;
  if ([...activeAgentConnectionsById.values()].some((info) => info.profileId === profileId)) {
    throw new Error("This catalog agent already has an active connection.");
  }
  const info: AgentConnectionInfo = {
    connectionId: `connection-${crypto.randomUUID()}`,
    profileId,
    bundleRoot,
    protocolVersion: "1",
    agent: { name: agentId, title: entry.name, version: entry.distribution.version },
    authMethods: [{
      id: "browser-login",
      name: "Sign in with browser",
      description: "The agent opens its own sign-in flow.",
    }],
    authenticated: false,
    capabilities: {
      loadSession: false,
      promptImage: false,
      promptAudio: false,
      promptEmbeddedContext: false,
      mcpHttp: false,
      mcpSse: false,
      sessionList: false,
      sessionResume: false,
      sessionClose: false,
    },
    securityScope: mockExternalSecurityScope(),
  };
  registerAgentConnection(info);
  saveLastAgentConnection({ kind: "catalog", id: agentId, name: rememberableName(info) });
  return info;
}

export async function connectLocalModel(
  profileId: string,
  model: string,
): Promise<AgentConnectionInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<AgentConnectionInfo>("connect_local_model", { profileId, model });
    registerAgentConnection(info);
    saveLastAgentConnection({ kind: "local", id: profileId, model, name: rememberableName(info) });
    return info;
  }
  const profile = mockLocalModelProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error("The Studio model profile was not found.");
  if (!model.trim()) throw new Error("Choose a model from the endpoint model list.");
  if ([...activeAgentConnectionsById.values()].some((info) => info.profileId === profileId)) {
    throw new Error("This Studio model profile already has an active connection.");
  }
  await browserMockDelay(80);
  const info: AgentConnectionInfo = {
    connectionId: `connection-${crypto.randomUUID()}`,
    profileId,
    bundleRoot: null,
    protocolVersion: "studio-native/1",
    agent: {
      name: "okf-studio-local",
      title: `${profile.name} · ${model}`,
      version: "0.6.0-dev",
    },
    authMethods: [],
    authenticated: true,
    capabilities: {
      loadSession: false,
      promptImage: false,
      promptAudio: false,
      promptEmbeddedContext: false,
      mcpHttp: false,
      mcpSse: false,
      sessionList: false,
      sessionResume: false,
      sessionClose: false,
    },
    securityScope: mockNativeSecurityScope(),
  };
  registerAgentConnection(info);
  saveLastAgentConnection({ kind: "local", id: profileId, model, name: rememberableName(info) });
  return info;
}

export function activeAgentConnections(): readonly AgentConnectionInfo[] {
  return activeAgentConnectionSnapshot;
}

export function subscribeAgentConnections(subscriber: () => void): () => void {
  activeAgentConnectionSubscribers.add(subscriber);
  return () => activeAgentConnectionSubscribers.delete(subscriber);
}

function assertConnectionBundle(connection: AgentConnectionInfo, bundleRoot: string): void {
  if (connection.bundleRoot !== null && connection.bundleRoot !== bundleRoot) {
    throw new Error(
      "This external agent connection belongs to another bundle. Disconnect it and connect again from the active bundle.",
    );
  }
}

function mockSessionConfigOptions(
  connection: AgentConnectionInfo,
): readonly AgentSessionConfigOption[] {
  const modelName = connection.agent?.title ?? connection.agent?.name ?? "Browser model";
  return [
    {
      id: "mode",
      name: "Mode",
      description: "How the agent approaches the next turn.",
      category: "mode",
      type: "select",
      currentValue: "agent",
      groups: [{
        id: null,
        name: null,
        options: [
          { value: "agent", name: "Agent", description: "Use the agent's advertised tools." },
          { value: "plan", name: "Plan", description: "Prepare a plan before acting." },
        ],
      }],
    },
    {
      id: "model",
      name: "Model",
      description: "The model selected by the agent for this session.",
      category: "model",
      type: "select",
      currentValue: "browser-primary",
      groups: [{
        id: "available",
        name: "Available models",
        options: [
          { value: "browser-primary", name: modelName, description: "Current session model." },
          { value: "browser-fast", name: "Browser fast", description: "Lower-latency fixture model." },
        ],
      }],
    },
    {
      id: "reasoning",
      name: "Reasoning",
      description: "Reasoning depth for the next turn.",
      category: "thought-level",
      type: "select",
      currentValue: "high",
      groups: [{
        id: null,
        name: null,
        options: [
          { value: "low", name: "Low", description: "Faster responses for direct work." },
          { value: "medium", name: "Medium", description: "Balanced reasoning depth." },
          { value: "high", name: "High", description: "More reasoning for complex work." },
        ],
      }],
    },
    {
      id: "concise",
      name: "Concise responses",
      description: "Prefer shorter agent responses when supported.",
      category: "_response_style",
      type: "boolean",
      currentValue: false,
    },
  ];
}

export async function newAgentSession(
  connectionId: string,
  bundleRoot: string,
): Promise<AgentSessionInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSessionInfo>("new_agent_session", { connectionId, bundleRoot });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) {
    throw new Error("Agent connection was not found.");
  }
  assertConnectionBundle(connection, bundleRoot);
  if (!connection.authenticated) throw new Error("Authenticate the agent before creating a session.");
  const sessionId = `session-${crypto.randomUUID()}`;
  clearMockThreadPermissionRules(connectionId, sessionId);
  const stagedState = {
    granted: false,
    grantMode: null,
    mode: "edit" as const,
    canRestore: mockBundleCheckpoints.has(bundleRoot),
    files: [],
  };
  const session: AgentSessionInfo = {
    connectionId,
    sessionId,
    bundleRoot,
    stagedChanges: {
      sessionId,
      ...stagedState,
    },
    configOptions: mockSessionConfigOptions(connection),
  };
  mockStagedChanges.set(session.sessionId, stagedState);
  mockAgentSessions.set(session.sessionId, {
    profileId: connection.profileId,
    bundleRoot,
    title: "Untitled session",
    updatedAt: new Date().toISOString(),
    messages: [],
    configOptions: session.configOptions,
  });
  queueMicrotask(() => emitAgentAvailableCommands({
    connectionId,
    sessionId,
    commands: connection.protocolVersion === "1"
      ? [{
          name: "compact",
          description: "Summarize this conversation and reduce its context usage.",
        }]
      : [],
  }));
  return session;
}

export async function listAgentSessions(
  connectionId: string,
  bundleRoot: string,
): Promise<AgentSessionHistoryPage> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSessionHistoryPage>("list_agent_sessions", { connectionId, bundleRoot });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) throw new Error("Agent connection was not found.");
  assertConnectionBundle(connection, bundleRoot);
  if (!connection.capabilities.sessionList) {
    throw new Error("This agent did not advertise session history support.");
  }
  await browserMockDelay(80);
  const liveSessions = [...mockAgentSessions.entries()]
    .filter(([, session]) =>
      session.profileId === connection.profileId && session.bundleRoot === bundleRoot
    )
    .map(([sessionId, session]) => ({
      sessionId,
      title: session.title,
      updatedAt: session.updatedAt,
    }));
  return {
    sessions: [
      ...liveSessions,
      {
        sessionId: "mock-session-research",
        title: "Trace bundle evidence",
        updatedAt: "2026-07-11T18:24:00Z",
      },
      {
        sessionId: "mock-session-validation",
        title: "Resolve validation warnings",
        updatedAt: "2026-07-10T09:12:00Z",
      },
    ],
    hasMore: false,
  };
}

export async function loadAgentSession(
  connectionId: string,
  bundleRoot: string,
  sessionId: string,
): Promise<AgentLoadedSessionInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentLoadedSessionInfo>("load_agent_session", {
      connectionId,
      bundleRoot,
      sessionId,
    });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) throw new Error("Agent connection was not found.");
  assertConnectionBundle(connection, bundleRoot);
  if (!connection.capabilities.loadSession) {
    throw new Error("This agent did not advertise session restore support.");
  }
  await browserMockDelay(80);
  clearMockThreadPermissionRules(connectionId, sessionId);
  // Mirrors Rust: a restored session never inherits a write grant or files.
  const stagedState = {
    granted: false,
    grantMode: null,
    mode: "edit" as const,
    canRestore: mockBundleCheckpoints.has(bundleRoot),
    files: [],
  };
  const stagedChanges: AgentStagedChangesInfo = {
    sessionId,
    ...stagedState,
  };
  mockStagedChanges.set(sessionId, stagedState);
  const liveSession = mockAgentSessions.get(sessionId);
  if (liveSession?.profileId === connection.profileId &&
    liveSession.bundleRoot === bundleRoot) {
    return {
      connectionId,
      sessionId,
      bundleRoot,
      messages: liveSession.messages,
      stagedChanges,
      configOptions: liveSession.configOptions,
    };
  }
  return {
    connectionId,
    sessionId,
    bundleRoot,
    stagedChanges,
    configOptions: mockSessionConfigOptions(connection),
    messages: [
      { role: "user", text: "Trace the evidence behind the bundle's product principles." },
      { role: "agent", text: "I traced the principles through the product overview and architecture concepts." },
    ],
  };
}

export async function setAgentSessionConfigOption(
  connectionId: string,
  sessionId: string,
  configId: string,
  value: AgentSessionConfigValueInput,
): Promise<AgentSessionConfigSnapshot> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSessionConfigSnapshot>("set_agent_session_config_option", {
      connectionId,
      sessionId,
      configId,
      value,
    });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) throw new Error("Agent connection was not found.");
  const session = mockAgentSessions.get(sessionId);
  if (!session) throw new Error("Agent session was not found on this connection.");
  const selected = session.configOptions.find((option) => option.id === configId);
  if (!selected) throw new Error("The agent did not advertise this session option.");
  let replacement: AgentSessionConfigOption;
  if (selected.type === "select" && value.type === "select") {
    const advertised = selected.groups
      .flatMap((group) => group.options)
      .some((option) => option.value === value.value);
    if (!advertised) {
      throw new Error("The agent did not advertise this value for the session option.");
    }
    replacement = { ...selected, currentValue: value.value };
  } else if (selected.type === "boolean" && value.type === "boolean") {
    replacement = { ...selected, currentValue: value.value };
  } else {
    throw new Error("The session option value has the wrong type.");
  }
  await browserMockDelay(80);
  session.configOptions = session.configOptions.map((option) =>
    option.id === configId ? replacement : option
  );
  return { sessionId, configOptions: session.configOptions };
}

export async function authenticateAgent(
  connectionId: string,
  methodId: string,
): Promise<boolean> {
  const current = activeAgentConnectionsById.get(connectionId);
  if (!current) throw new Error("Agent connection was not found.");
  if (!current.authMethods.some((method) => method.id === methodId)) {
    throw new Error("Authentication method was not advertised by the agent.");
  }
  let authenticated: boolean;
  if (isTauri()) {
    authenticated = await import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<boolean>("authenticate_agent", { connectionId, methodId }),
    );
  } else {
    await browserMockDelay(80);
    authenticated = true;
  }
  if (authenticated) {
    const latest = activeAgentConnectionsById.get(connectionId);
    if (latest) {
      activeAgentConnectionsById.set(connectionId, { ...latest, authenticated: true });
      publishAgentConnections();
      rememberAuthMethod(latest.profileId, methodId);
    }
  }
  return authenticated;
}

export async function promptAgent(
  connectionId: string,
  sessionId: string,
  text: string,
  contextPaths: readonly string[] = [],
  sources: readonly AgentSourceInput[] = [],
  taskContext?: {
    taskId: OkfTaskId;
    contextManifest: AcceptedOkfContextManifest;
  },
): Promise<AgentTurnInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentTurnInfo>("prompt_agent", {
      connectionId,
      sessionId,
      text,
      contextPaths,
      sources,
      taskContext,
    });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) {
    throw new Error("Agent connection was not found.");
  }
  if (text.startsWith("Reject:")) {
    await browserMockDelay(80);
    throw new Error("The browser mock rejected this prompt before starting a turn.");
  }
  const info: AgentTurnInfo = {
    connectionId,
    sessionId,
    turnId: `turn-${crypto.randomUUID()}`,
    capabilityContext: [{
      capabilityId: "okf-core",
      version: "0.1.0",
      manifestSha256: "browser-mock",
      support: "full",
      delivery: connection.protocolVersion === "studio-native/1"
        ? "catalog-only"
        : "embedded-resources",
      resourceIds: connection.protocolVersion === "studio-native/1"
        ? []
        : ["instructions", "specification", "commands", "templates"],
      observedResourceIds: [],
    }, ...(taskContext ? OKF_TASKS[taskContext.taskId].capabilityIds.map((capabilityId) => ({
      capabilityId,
      version: "0.1.0",
      manifestSha256: "browser-mock",
      support: "full" as const,
      delivery: connection.protocolVersion === "studio-native/1"
        ? "catalog-only" as const
        : "embedded-resources" as const,
      resourceIds: connection.protocolVersion === "studio-native/1" ? [] : ["instructions"],
      observedResourceIds: [],
    })) : [])],
  };
  const mockSession = mockAgentSessions.get(sessionId);
  if (mockSession) {
    mockSession.title = text.replace(/\s+/gu, " ").trim().slice(0, 80) || "Untitled session";
    mockSession.updatedAt = new Date().toISOString();
    mockSession.messages = [...mockSession.messages, { role: "user", text }];
  }
  mockCancelledTurns.delete(info.turnId);
  void (connection.protocolVersion === "studio-native/1"
    ? emitMockLocalTurn(info, text, sources, taskContext)
    : emitMockTurn(info, text, taskContext));
  return info;
}

export async function exportAgentTranscript(
  suggestedName: string,
  markdown: string,
): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("export_agent_transcript", { suggestedName, markdown });
  }
  await browserMockDelay(80);
  if (markdown.includes("> Export fail:")) {
    throw new Error("The browser mock could not save the transcript.");
  }
  return suggestedName;
}

export interface AgentSourceInput {
  title: string;
  content: string;
  origin?: string;
  mediaType?: string;
  sourceDigest?: string;
  warning?: string;
  imageData?: string;
  adapterReceipt?: AgentSourceAdapterReceipt;
}

export async function promptAgentCritic(
  connectionId: string,
  sessionId: string,
  text: string,
): Promise<AgentTurnInfo> {
  if (!isTauri()) {
    return promptAgent(connectionId, sessionId, text);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentTurnInfo>("prompt_agent_critic", {
    connectionId,
    sessionId,
    text,
  });
}

export type AgentSourceDiscovery = "file" | "folder" | "url" | "image";

export interface AgentSourceDiagnostic {
  level: "warning";
  code: string;
  message: string;
}

export interface AgentSourceAdapterReceipt {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: number;
  observedAt?: string;
  discovery: AgentSourceDiscovery;
  origin: string;
  mediaType: string;
  sourceFingerprint: string;
  evidenceFingerprint: string;
  refreshFingerprint: string;
  trust: "untrusted";
  diagnostics: readonly AgentSourceDiagnostic[];
}

function browserSourceReceipt(
  adapterId: string,
  discovery: AgentSourceDiscovery,
  origin: string,
  mediaType: string,
  sourceDigit: string,
  evidenceDigit: string,
  diagnostics: readonly AgentSourceDiagnostic[] = [],
): AgentSourceAdapterReceipt {
  return {
    schemaVersion: 1,
    adapterId,
    adapterVersion: 1,
    observedAt: new Date().toISOString(),
    discovery,
    origin,
    mediaType,
    sourceFingerprint: `sha256-${sourceDigit.repeat(64)}`,
    evidenceFingerprint: `sha256-${evidenceDigit.repeat(64)}`,
    refreshFingerprint: `source-refresh-v1-${sourceDigit.repeat(64)}`,
    trust: "untrusted",
    diagnostics,
  };
}

export async function pickAgentTextSources(limit: number): Promise<AgentSourceInput[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSourceInput[]>("pick_agent_text_sources", { limit });
  }
  await browserMockDelay(80);
  return [{
    title: "research-report.pdf",
    content: "## Page 1\n\nQuarterly research findings.",
    origin: "research-report.pdf",
    mediaType: "application/pdf",
    sourceDigest: "a".repeat(64),
    warning: "1 of 3 pages had no extractable text. OCR was not used.",
    adapterReceipt: browserSourceReceipt(
      "pdf",
      "file",
      "research-report.pdf",
      "application/pdf",
      "a",
      "e",
      [{
        level: "warning",
        code: "pdf-partial-extraction",
        message: "1 of 3 pages had no extractable text. OCR was not used.",
      }],
    ),
  }].slice(0, Math.max(0, limit));
}

export async function pickAgentSourceFolder(limit: number): Promise<AgentSourceInput[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSourceInput[]>("pick_agent_source_folder", { limit });
  }
  await browserMockDelay(80);
  return [
    {
      title: "data/findings.csv",
      content: "## CSV columns\n\n- Column 1: finding\n- Column 2: status\n\n## Rows 1-1\n\n| Row | Column 1: finding | Column 2: status |\n| ---: | --- | --- |\n| 1 | Schema drift | confirmed |\n",
      origin: "data/findings.csv",
      mediaType: "text/csv",
      sourceDigest: "b".repeat(64),
      adapterReceipt: browserSourceReceipt(
        "csv", "folder", "data/findings.csv", "text/csv", "b", "f",
      ),
    },
    {
      title: "config/settings.json",
      content: "## JSON structure\n\nPaths use JSON Pointer. `(root)` identifies the complete document.\n\n## Nodes 1-5\n\n| Node | JSON Pointer | Type | Value |\n| ---: | --- | --- | --- |\n| 1 | (root) | object | 2 properties |\n| 2 | /mode | string | \"research\" |\n| 3 | /sources | array | 2 items |\n| 4 | /sources/0 | string | \"csv\" |\n| 5 | /sources/1 | string | \"pdf\" |\n",
      origin: "config/settings.json",
      mediaType: "application/json",
      sourceDigest: "c".repeat(64),
      adapterReceipt: browserSourceReceipt(
        "json", "folder", "config/settings.json", "application/json", "c", "1",
      ),
    },
  ].slice(0, Math.max(0, limit));
}

export async function pickAgentImageSources(limit: number): Promise<AgentSourceInput[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSourceInput[]>("pick_agent_image_sources", { limit });
  }
  await browserMockDelay(80);
  return [{
    title: "architecture.png",
    content: "",
    origin: "architecture.png",
    mediaType: "image/png",
    sourceDigest: "3c7474b4239ada3342d87f25ec8849eb8473ee35c5471452482686098b49e81b",
    imageData: "iVBORw0KGgppbWFnZQ==",
    adapterReceipt: browserSourceReceipt(
      "image", "image", "architecture.png", "image/png", "3", "3",
    ),
  }].slice(0, Math.max(0, limit));
}

export async function fetchAgentSourceUrl(url: string): Promise<AgentSourceInput> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentSourceInput>("fetch_agent_source_url", { url });
  }
  await browserMockDelay(80);
  return {
    title: "research.html",
    content: "# Remote research\n\nFetched evidence.",
    origin: "https://example.com/research.html",
    mediaType: "text/html",
    sourceDigest: "d".repeat(64),
    adapterReceipt: browserSourceReceipt(
      "html", "url", "https://example.com/research.html", "text/html", "d", "2",
    ),
  };
}

export async function cancelAgentTurn(
  connectionId: string,
  sessionId: string,
  turnId: string,
): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("cancel_agent_turn", { connectionId, sessionId, turnId });
  }
  mockCancelledTurns.add(turnId);
  for (const [requestId, pending] of mockPermissionResponses) {
    if (pending.turnId !== turnId) continue;
    mockPermissionResponses.delete(requestId);
    pending.resolve(null);
  }
  return true;
}

export async function respondAgentPermission(
  requestId: string,
  optionId: string | null,
  rememberForThread: boolean,
): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("respond_agent_permission", {
      requestId,
      optionId,
      rememberForThread,
    });
  }
  const pending = mockPermissionResponses.get(requestId);
  if (!pending) return false;
  if (optionId !== null && !pending.optionIds.has(optionId)) {
    throw new Error("Permission option was not offered by the agent.");
  }
  if (rememberForThread) {
    const decision = optionId === null ? undefined : pending.optionDecisions.get(optionId);
    if (!decision) {
      throw new Error("Only an allow-once or reject-once choice can become a thread rule.");
    }
    mockThreadPermissionRules.set(pending.ruleKey, decision);
  }
  mockPermissionResponses.delete(requestId);
  pending.resolve(optionId);
  return true;
}

/**
 * Subscribe to one agent channel through the boundary check.
 *
 * Every agent event arrives inside an envelope carrying a host-wide sequence.
 * Unwrapping it here, rather than at each call site, is what makes "a dropped
 * event is reported" true for all six channels at once.
 */
async function listenAgentChannel(
  channel: string,
  handler: (data: unknown) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<unknown>(channel, (event) => {
    const data = acceptAgentEnvelope(channel, event.payload);
    if (data !== null) handler(data);
  });
}

/**
 * Subscribe to host milestones.
 *
 * Under Tauri these come from the Rust bus; in the browser mock they come from
 * the same classification applied to the mock's own turn events, so a test
 * waits on one signal either way.
 */
/** How a bundle-sized job divides into runs. Mirrors `SliceBy` in okf-core. */
export type SliceBy = "folder" | "type" | "tag" | "link-neighbourhood";

export interface SliceLimits {
  maxSlices: number;
  maxConceptsPerSlice: number;
}

export interface Slice {
  key: string;
  title: string;
  conceptIds: string[];
  excludedConceptIds: string[];
}

/** Why something is not in the plan. A cap that truncates silently reads, from
 *  the outside, exactly like a bundle with less in it. */
export type SliceExclusion =
  | { kind: "slicesOverWidth"; droppedKeys: string[]; limit: number }
  | { kind: "conceptsOverSliceCap"; sliceKey: string; dropped: number; limit: number }
  | { kind: "unslicable"; conceptIds: string[]; reason: string };

export interface SlicePlan {
  by: SliceBy;
  /** The bundle state this plan was computed against. */
  fingerprint: string;
  slices: Slice[];
  exclusions: SliceExclusion[];
}

export const defaultSliceLimits: SliceLimits = { maxSlices: 12, maxConceptsPerSlice: 40 };

/**
 * Plan how a job over `root` divides into bounded runs.
 *
 * Read-only: this computes a preview and starts nothing.
 */
export async function planAgentSlices(
  root: string,
  by: SliceBy,
  limits: SliceLimits = defaultSliceLimits,
): Promise<SlicePlan> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SlicePlan>("plan_agent_slices", { root, request: { by, limits } });
  }
  return mockPlanAgentSlices(by, limits);
}

/**
 * The browser mock, planning over the fixture bundle with the same rules the
 * Rust service uses: sorted keys, sorted ids, named exclusions.
 */
function mockPlanAgentSlices(by: SliceBy, limits: SliceLimits): SlicePlan {
  const concepts = MOCK_BUNDLE.concepts;
  const groups = new Map<string, { title: string; ids: Set<string> }>();
  const unslicable: string[] = [];
  const add = (key: string, title: string, id: string) => {
    const group = groups.get(key) ?? { title, ids: new Set<string>() };
    group.ids.add(id);
    groups.set(key, group);
  };
  for (const concept of concepts) {
    if (by === "folder") {
      const cut = concept.id.lastIndexOf("/");
      const folder = cut === -1 ? "" : concept.id.slice(0, cut);
      add(folder, folder === "" ? "Bundle root" : folder, concept.id);
    } else if (by === "type") {
      if (!concept.type.trim()) unslicable.push(concept.id);
      else add(concept.type, concept.type, concept.id);
    } else if (by === "tag") {
      const tags = concept.tags.filter((tag: string) => tag.trim());
      if (tags.length === 0) unslicable.push(concept.id);
      for (const tag of tags) add(tag, tag, concept.id);
    } else {
      const neighbourhood = new Set([concept.id, ...concept.links, ...concept.citedBy]);
      groups.set(concept.id, { title: concept.title, ids: neighbourhood });
    }
  }

  const exclusions: SliceExclusion[] = [];
  if (unslicable.length > 0) {
    exclusions.push({
      kind: "unslicable",
      conceptIds: [...unslicable].sort(),
      reason: by === "type" ? "the concept declares no type" : "the concept declares no tags",
    });
  }
  const keys = [...groups.keys()].sort();
  const kept = keys.slice(0, limits.maxSlices);
  const droppedKeys = keys.slice(limits.maxSlices);
  if (droppedKeys.length > 0) {
    exclusions.push({ kind: "slicesOverWidth", droppedKeys, limit: limits.maxSlices });
  }
  const slices = kept.flatMap((key) => {
    const group = groups.get(key);
    if (!group) return [];
    const all = [...group.ids].sort();
    const conceptIds = all.slice(0, limits.maxConceptsPerSlice);
    const excludedConceptIds = all.slice(limits.maxConceptsPerSlice);
    if (excludedConceptIds.length > 0) {
      exclusions.push({
        kind: "conceptsOverSliceCap",
        sliceKey: key,
        dropped: excludedConceptIds.length,
        limit: limits.maxConceptsPerSlice,
      });
    }
    return [{ key, title: group.title, conceptIds, excludedConceptIds }];
  });
  return { by, fingerprint: `mock-${MOCK_BUNDLE.concepts.length}`, slices, exclusions };
}

// ---------------------------------------------------------------------------
// Document intake plans (see docs/features/document-intake.md). The plan is
// computed in Rust from explicitly picked documents, is deterministic for the
// same selection, and is never authority: nothing runs or writes from it.

export interface IntakePlanSource {
  title: string;
  mediaType: string;
  pageCount: number;
  sourceFingerprint: string;
  refreshFingerprint: string;
  warningCodes: string[];
}

export interface IntakePlanConcept {
  id: string;
  title: string;
  sourceTitle: string;
  /** Page and line locators; zero pages mean the whole unpaged document. */
  startPage: number;
  startLine: number;
  /** Exclusive upper bound: the next split point, or one past the end. */
  untilPage: number;
  untilLine: number;
  /** The user's keep/drop adjustment. Computation proposes everything. */
  included: boolean;
}

export interface IntakePlanExclusion {
  sourceTitle: string;
  kind: string;
  text: string;
  occurrences: number;
  reason: string;
}

export interface IntakePlanEvidence {
  sourceTitle: string;
  marker: number;
  text: string;
  url: string | null;
  statedDate: string | null;
  page: number;
}

export interface IntakePlanGap {
  sourceTitle: string;
  kind: string;
  caption: string;
  page: number;
}

export interface IntakePlan {
  schemaVersion: number;
  planId: string;
  sources: IntakePlanSource[];
  concepts: IntakePlanConcept[];
  exclusions: IntakePlanExclusion[];
  evidence: IntakePlanEvidence[];
  gaps: IntakePlanGap[];
  omitted: number;
}

export interface SavedIntakePlan {
  bundleRoot: string;
  savedAt: string;
  plan: IntakePlan;
}

/** A computed plan beside the attachment evidence it was computed from. The
 *  sources half lives only in the running session; saving keeps the plan. */
export interface PlannedIntake {
  plan: IntakePlan;
  sources: AgentSourceInput[];
}

/** Pick documents and compute their intake plan. Null means the picker was
 *  cancelled, which is not an empty plan. */
export async function planDocumentIntake(): Promise<PlannedIntake | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<PlannedIntake | null>("plan_document_intake");
  }
  return {
    plan: structuredClone(MOCK_INTAKE_PLAN),
    sources: [
      {
        title: "network-report.pdf",
        content: "## Page 1\n\nAn Introduction to the Example Network",
        origin: "network-report.pdf",
        mediaType: "application/pdf",
      },
      {
        title: "why-we-build.pdf",
        content: "## Page 1\n\nWHY WE A RE B UILDING CARDANO",
        origin: "why-we-build.pdf",
        mediaType: "application/pdf",
      },
    ],
  };
}

export async function saveIntakePlan(root: string, plan: IntakePlan): Promise<SavedIntakePlan> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SavedIntakePlan>("save_intake_plan", { root, plan });
  }
  const saved: SavedIntakePlan = {
    bundleRoot: root,
    savedAt: new Date().toISOString(),
    plan: structuredClone(plan),
  };
  mockSavedIntakePlans = [
    saved,
    ...mockSavedIntakePlans.filter(
      (entry) => entry.bundleRoot !== root || entry.plan.planId !== plan.planId,
    ),
  ];
  return saved;
}

export async function savedIntakePlans(root: string): Promise<SavedIntakePlan[]> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SavedIntakePlan[]>("saved_intake_plans", { root });
  }
  return mockSavedIntakePlans.filter((entry) => entry.bundleRoot === root);
}

export async function removeIntakePlan(root: string, planId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("remove_intake_plan", { root, planId });
  }
  const before = mockSavedIntakePlans.length;
  mockSavedIntakePlans = mockSavedIntakePlans.filter(
    (entry) => entry.bundleRoot !== root || entry.plan.planId !== planId,
  );
  return mockSavedIntakePlans.length !== before;
}

let mockSavedIntakePlans: SavedIntakePlan[] = [];

/** The browser mock's plan: the measured shapes of the research-PDF dogfood,
 *  so the preview and stories exercise realistic furniture, footnotes, and
 *  figure gaps rather than a convenient empty object. */
const MOCK_INTAKE_PLAN: IntakePlan = {
  schemaVersion: 1,
  planId: "a".repeat(64),
  sources: [
    {
      title: "network-report.pdf",
      mediaType: "application/pdf",
      pageCount: 21,
      sourceFingerprint: "sha256-mock-report",
      refreshFingerprint: "sha256-refresh-mock-report",
      warningCodes: ["pdf-repeated-furniture"],
    },
    {
      title: "why-we-build.pdf",
      mediaType: "application/pdf",
      pageCount: 44,
      sourceFingerprint: "sha256-mock-essay",
      refreshFingerprint: "sha256-refresh-mock-essay",
      warningCodes: ["pdf-glyph-spacing"],
    },
  ],
  concepts: [
    { id: "c0", title: "An Introduction to the Example Network", sourceTitle: "network-report.pdf", startPage: 1, startLine: 1, untilPage: 4, untilLine: 1, included: true },
    { id: "c1", title: "Background", sourceTitle: "network-report.pdf", startPage: 4, startLine: 1, untilPage: 6, untilLine: 1, included: true },
    { id: "c2", title: "Brief History", sourceTitle: "network-report.pdf", startPage: 6, startLine: 1, untilPage: 9, untilLine: 1, included: true },
    { id: "c3", title: "Key Features", sourceTitle: "network-report.pdf", startPage: 9, startLine: 1, untilPage: 16, untilLine: 1, included: true },
    { id: "c4", title: "Important Disclosures and Other Information", sourceTitle: "network-report.pdf", startPage: 16, startLine: 1, untilPage: 22, untilLine: 1, included: true },
    { id: "c5", title: "1. Introduction", sourceTitle: "why-we-build.pdf", startPage: 1, startLine: 1, untilPage: 12, untilLine: 1, included: true },
    { id: "c6", title: "2. Science and Engineering", sourceTitle: "why-we-build.pdf", startPage: 12, startLine: 1, untilPage: 22, untilLine: 1, included: true },
    { id: "c7", title: "3. Interoperability", sourceTitle: "why-we-build.pdf", startPage: 22, startLine: 1, untilPage: 45, untilLine: 1, included: true },
  ],
  exclusions: [
    {
      sourceTitle: "network-report.pdf",
      kind: "furniture-running-line",
      text: "REVIEW THE IMPORTANT DISCLOSURES AT THE END OF THIS DOCUMENT.",
      occurrences: 21,
      reason: "Repeats 21 times across pages in a stable position.",
    },
    {
      sourceTitle: "network-report.pdf",
      kind: "furniture-margin-rail",
      text: "7",
      occurrences: 13,
      reason: "Repeats 13 times across pages in a stable position.",
    },
    {
      sourceTitle: "why-we-build.pdf",
      kind: "furniture-running-line",
      text: "IOHK | WHY WE A RE B UILDING C ARDANO | 0 6/28/2017",
      occurrences: 44,
      reason: "Repeats 44 times across pages in a stable position.",
    },
  ],
  evidence: [
    {
      sourceTitle: "network-report.pdf",
      marker: 3,
      text: "Datasource https://example.com/asset/profile (Date: 9/7/2021)",
      url: "https://example.com/asset/profile",
      statedDate: "9/7/2021",
      page: 8,
    },
    {
      sourceTitle: "network-report.pdf",
      marker: 7,
      text: "Coinmetrics (Date: 9/11/2021)",
      url: null,
      statedDate: "9/11/2021",
      page: 11,
    },
  ],
  gaps: [
    { sourceTitle: "network-report.pdf", kind: "figure", caption: "FIGURE 2: TOTAL TOKEN DISTRIBUTION", page: 7 },
    { sourceTitle: "network-report.pdf", kind: "figure", caption: "FIGURE 4: TOKEN DISTRIBUTION SCHEDULE", page: 8 },
  ],
  omitted: 0,
};

export interface RunBudget {
  maxCost: number | null;
  maxContextTokens: number | null;
}

export interface RunProvenance {
  capabilityId: string;
  capabilityVersion: string;
  capabilityDigest: string;
  sliceKey: string;
  sliceFingerprint: string;
}

export interface DelegatedRun {
  runId: string;
  conceptIds: string[];
  artifactKind: string;
  budget: RunBudget;
  tools: string[];
  provenance: RunProvenance;
}

/** A resolved run and the prompt Rust built for it. */
export interface PreparedRun {
  run: DelegatedRun;
  prompt: string;
}

/** Why a run will not start. Every variant names what to change. */
export interface RunRefusal {
  reason: string;
  [field: string]: unknown;
}

export type RunResult =
  | { status: "completed"; artifactKind: string; itemCount: number }
  | { status: "failed"; message: string }
  | { status: "stoppedAtBudget"; spentDescription: string }
  | { status: "completedWithoutArtifact"; reason: string };

export interface RunOutcome {
  runId: string;
  sliceKey: string;
  sliceFingerprint: string;
  result: RunResult;
}

export type AssemblyExclusion =
  | { kind: "staleRun"; runId: string; sliceKey: string; sliceFingerprint: string }
  | { kind: "failedRun"; runId: string; sliceKey: string; message: string }
  | { kind: "stoppedAtBudget"; runId: string; sliceKey: string; spentDescription: string }
  | { kind: "noArtifact"; runId: string; sliceKey: string; reason: string }
  | { kind: "sliceNeverReported"; sliceKey: string };

export interface Assembly {
  fingerprint: string;
  included: RunOutcome[];
  exclusions: AssemblyExclusion[];
  plannedSlices: number;
  coveredSlices: number;
  itemCount: number;
  complete: boolean;
}

/**
 * Resolve one run and build its prompt, or return why it will not start.
 *
 * The outer promise rejects only when the command itself failed. A refusal is a
 * value: "this run is not allowed" is an answer, not an error.
 */
export async function prepareAgentRun(
  root: string,
  request: {
    sliceKey: string;
    conceptIds: string[];
    sliceFingerprint: string;
    capabilityId: string;
    artifactKind: string;
    budget: RunBudget;
    depth?: number;
  },
  runId: string,
): Promise<{ ok: true; prepared: PreparedRun } | { ok: false; refusal: RunRefusal }> {
  if (!isTauri()) return mockPrepareAgentRun(request, runId);
  const { invoke } = await import("@tauri-apps/api/core");
  // Rust returns a Result, which serialises as exactly one of these arms, so
  // the union narrows without an assertion.
  const result = await invoke<{ Ok: PreparedRun } | { Err: RunRefusal }>("prepare_agent_run", {
    root,
    request: { depth: 0, ...request },
    runId,
  });
  if ("Ok" in result) return { ok: true, prepared: result.Ok };
  return { ok: false, refusal: result.Err };
}

/** Send a run's prompt on an isolated session that carries no write grant. */
export async function promptAgentRun(
  connectionId: string,
  sessionId: string,
  text: string,
  conceptPaths: string[],
): Promise<AgentTurnInfo> {
  if (!isTauri()) return promptAgent(connectionId, sessionId, text);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentTurnInfo>("prompt_agent_run", {
    connectionId,
    sessionId,
    text,
    conceptPaths,
  });
}

/** Assemble what a fan-out returned, naming everything it could not merge. */
export async function assembleAgentRuns(
  root: string,
  outcomes: RunOutcome[],
  plannedSliceKeys: string[],
): Promise<Assembly> {
  if (!isTauri()) return mockAssembleAgentRuns(outcomes, plannedSliceKeys);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Assembly>("assemble_agent_runs", { root, outcomes, plannedSliceKeys });
}

/** The browser mock's resolution, mirroring the refusals Rust enforces. */
function mockPrepareAgentRun(
  request: Parameters<typeof prepareAgentRun>[1],
  runId: string,
): { ok: true; prepared: PreparedRun } | { ok: false; refusal: RunRefusal } {
  if ((request.depth ?? 0) !== 0) {
    return { ok: false, refusal: { reason: "nestedDelegation", depth: request.depth } };
  }
  if (request.conceptIds.length === 0) {
    return { ok: false, refusal: { reason: "emptySlice", sliceKey: request.sliceKey } };
  }
  const measurable =
    (request.budget.maxCost ?? 0) > 0 || (request.budget.maxContextTokens ?? 0) > 0;
  if (!measurable) return { ok: false, refusal: { reason: "unbudgeted" } };

  const conceptIds = [...new Set(request.conceptIds)].sort();
  const run: DelegatedRun = {
    runId,
    conceptIds,
    artifactKind: request.artifactKind,
    budget: request.budget,
    tools: ["okf_inspect", "okf_health_summary"],
    provenance: {
      capabilityId: request.capabilityId,
      capabilityVersion: "1.0.0",
      capabilityDigest: "mock-digest",
      sliceKey: request.sliceKey,
      sliceFingerprint: request.sliceFingerprint,
    },
  };
  return {
    ok: true,
    prepared: {
      run,
      prompt:
        `OKF delegated run ${runId}, capability ${request.capabilityId} 1.0.0.\n\n` +
        `Work only on the ${conceptIds.length} concept(s) listed below. You cannot write.\n\n` +
        `Concepts in this run:\n${conceptIds.map((id) => `- ${id}`).join("\n")}\n`,
    },
  };
}

function mockAssembleAgentRuns(outcomes: RunOutcome[], plannedSliceKeys: string[]): Assembly {
  const sorted = [...outcomes].sort(
    (left, right) => left.sliceKey.localeCompare(right.sliceKey) || left.runId.localeCompare(right.runId),
  );
  const fingerprint = sorted.find((outcome) => outcome.sliceFingerprint)?.sliceFingerprint ?? "";
  const included: RunOutcome[] = [];
  const exclusions: AssemblyExclusion[] = [];
  const reported = new Set<string>();
  for (const outcome of sorted) {
    reported.add(outcome.sliceKey);
    const { runId, sliceKey } = outcome;
    if (outcome.sliceFingerprint !== fingerprint) {
      exclusions.push({ kind: "staleRun", runId, sliceKey, sliceFingerprint: outcome.sliceFingerprint });
    } else if (outcome.result.status === "failed") {
      exclusions.push({ kind: "failedRun", runId, sliceKey, message: outcome.result.message });
    } else if (outcome.result.status === "stoppedAtBudget") {
      exclusions.push({
        kind: "stoppedAtBudget",
        runId,
        sliceKey,
        spentDescription: outcome.result.spentDescription,
      });
    } else if (outcome.result.status === "completedWithoutArtifact") {
      exclusions.push({ kind: "noArtifact", runId, sliceKey, reason: outcome.result.reason });
    } else {
      included.push(outcome);
    }
  }
  for (const key of plannedSliceKeys) {
    if (!reported.has(key)) exclusions.push({ kind: "sliceNeverReported", sliceKey: key });
  }
  const coveredSlices = new Set(included.map((outcome) => outcome.sliceKey)).size;
  const itemCount = included.reduce(
    (total, outcome) => total + (outcome.result.status === "completed" ? outcome.result.itemCount : 0),
    0,
  );
  return {
    fingerprint,
    included,
    exclusions,
    plannedSlices: plannedSliceKeys.length,
    coveredSlices,
    itemCount,
    complete: exclusions.length === 0 && coveredSlices === plannedSliceKeys.length,
  };
}

export async function onAgentMilestoneUpdate(
  handler: (milestone: AgentMilestone) => void,
): Promise<() => void> {
  if (!isTauri()) return onAgentMilestone(handler);
  return listenAgentChannel("agent-milestone", (data) => handler(data as AgentMilestone));
}

export async function onAgentTurnUpdate(handler: AgentTurnHandler): Promise<() => void> {
  if (!isTauri()) {
    agentTurnHandlers.add(handler);
    return () => agentTurnHandlers.delete(handler);
  }
  return listenAgentChannel("agent-turn-update", (data) => handler(data as AgentTurnEvent));
}

export async function onAgentPermissionUpdate(
  handler: AgentPermissionHandler,
): Promise<() => void> {
  if (!isTauri()) {
    agentPermissionHandlers.add(handler);
    return () => agentPermissionHandlers.delete(handler);
  }
  return listenAgentChannel("agent-permission-update", (data) =>
    handler(data as AgentPermissionEvent),
  );
}

export async function onAgentStageUpdate(handler: AgentStageHandler): Promise<() => void> {
  if (!isTauri()) {
    agentStageHandlers.add(handler);
    return () => agentStageHandlers.delete(handler);
  }
  return listenAgentChannel("agent-stage-update", (data) => handler(data as AgentStageEvent));
}

export async function onAgentSessionConfigUpdate(
  handler: AgentSessionConfigHandler,
): Promise<() => void> {
  if (!isTauri()) {
    agentSessionConfigHandlers.add(handler);
    return () => agentSessionConfigHandlers.delete(handler);
  }
  return listenAgentChannel("agent-session-config-update", (data) =>
    handler(data as AgentSessionConfigEvent),
  );
}

export async function onAgentAvailableCommandsUpdate(
  handler: AgentAvailableCommandsHandler,
): Promise<() => void> {
  if (!isTauri()) {
    agentAvailableCommandsHandlers.add(handler);
    return () => agentAvailableCommandsHandlers.delete(handler);
  }
  return listenAgentChannel("agent-available-commands-update", (data) =>
    handler(data as AgentAvailableCommandsEvent),
  );
}

export async function setAgentWriteGrant(
  connectionId: string,
  sessionId: string,
  granted: boolean,
  mode: "interactive" | "unattended",
): Promise<AgentStagedChangesInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedChangesInfo>("set_agent_write_grant", {
      connectionId,
      sessionId,
      granted,
      mode,
    });
  }
  const connection = activeAgentConnectionsById.get(connectionId);
  if (!connection) {
    throw new Error("Agent connection was not found.");
  }
  if (granted && mode === "unattended" && !connection.securityScope.profile.unattendedEligible) {
    throw new Error(
      "Unattended writes denied: this live connection has no eligible restricted-host evidence. Use the interactive thread grant.",
    );
  }
  const state = mockStageState(sessionId);
  state.granted = granted;
  state.grantMode = granted ? mode : null;
  return emitMockStage(connectionId, sessionId);
}

export async function discardAgentStagedChanges(
  connectionId: string,
  sessionId: string,
): Promise<AgentStagedChangesInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedChangesInfo>("discard_agent_staged_changes", {
      connectionId,
      sessionId,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  state.files = [];
  return emitMockStage(connectionId, sessionId);
}

export async function setAgentStageMode(
  connectionId: string,
  sessionId: string,
  mode: "edit" | "enhance" | "create",
): Promise<AgentStagedChangesInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedChangesInfo>("set_agent_stage_mode", {
      connectionId,
      sessionId,
      mode,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  if (state.files.length > 0 && state.mode !== mode) {
    throw new Error("Resolve the current staged changes before changing the staging mode.");
  }
  state.mode = mode;
  return emitMockStage(connectionId, sessionId);
}

function mockStageState(sessionId: string): {
  granted: boolean;
  grantMode: "interactive" | "unattended" | null;
  mode: "edit" | "enhance" | "create";
  canRestore: boolean;
  files: MockStagedFile[];
} {
  let state = mockStagedChanges.get(sessionId);
  if (!state) {
    state = { granted: false, grantMode: null, mode: "edit", canRestore: false, files: [] };
    mockStagedChanges.set(sessionId, state);
  }
  return state;
}

function emitMockStage(connectionId: string, sessionId: string): AgentStagedChangesInfo {
  const state = mockStageState(sessionId);
  const changes: AgentStagedChangesInfo = {
    sessionId,
    granted: state.granted,
    grantMode: state.grantMode,
    mode: state.mode,
    canRestore: state.mode !== "create" && state.canRestore,
    files: state.files.map(({ path, bytes, kind }) => ({ path, bytes, kind })),
  };
  for (const handler of agentStageHandlers) handler({ connectionId, changes });
  return changes;
}

export async function agentStagedFileDiff(
  connectionId: string,
  sessionId: string,
  path: string,
): Promise<AgentStagedFileDiff> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedFileDiff>("agent_staged_file_diff", {
      connectionId,
      sessionId,
      path,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const file = mockStageState(sessionId).files.find((candidate) => candidate.path === path);
  if (!file) throw new Error("This file is not staged.");
  const added = file.content.split("\n").map((line) => `+${line}`).join("\n");
  const revision = `mock:${path}:${file.content.length}`;
  return {
    path,
    kind: file.kind,
    revision,
    hunks: [{
      index: 0,
      header: "@@ -0,0 +1 @@",
      unified: `${added}\n`,
      selected: file.hunkSelected,
      reviewed: file.hunkReviewed,
    }],
    truncated: false,
  };
}

export async function setAgentStagedHunkSelection(
  connectionId: string,
  sessionId: string,
  path: string,
  revision: string,
  hunkIndex: number,
  selected: boolean,
): Promise<AgentStagedFileDiff> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedFileDiff>("set_agent_staged_hunk_selection", {
      connectionId,
      sessionId,
      path,
      revision,
      hunkIndex,
      selected,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const file = mockStageState(sessionId).files.find((candidate) => candidate.path === path);
  if (!file) throw new Error("This file is not staged.");
  if (revision !== `mock:${path}:${file.content.length}` || hunkIndex !== 0) {
    throw new Error("The staged diff changed. Review the file again.");
  }
  file.hunkSelected = selected;
  file.hunkReviewed = true;
  return agentStagedFileDiff(connectionId, sessionId, path);
}

export async function validateAgentStagedChanges(
  connectionId: string,
  sessionId: string,
): Promise<AgentStagedValidationInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedValidationInfo>("validate_agent_staged_changes", {
      connectionId,
      sessionId,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  if (state.files.length === 0) throw new Error("There are no staged changes to validate.");
  const unreviewed = state.files.find((file) => (
    state.mode === "enhance" && file.kind === "modify" && !file.hunkReviewed
  ));
  if (unreviewed) {
    throw new Error(
      `Review ${unreviewed.path} and choose Keep or Reject for 1 hunk before validating this enhancement.`,
    );
  }
  const issues = state.files.flatMap((file) => {
    if (
      !file.hunkSelected ||
      !file.path.toLowerCase().endsWith(".md") ||
      file.path.toLowerCase().endsWith("index.md") ||
      file.content.includes("type:")
    ) return [];
    return [{
      path: file.path,
      level: "error" as const,
      message: "Missing required frontmatter field: type.",
    }];
  });
  const preview = mockStagedGraphPreview(state);
  const profiles = mockProfileReport();
  return {
    sessionId,
    revision: `mock-${state.files.map((file) => (
      `${file.path}:${file.content.length}:${file.hunkSelected ? "keep" : "reject"}`
    )).join("|")}`,
    errors: issues.length,
    warnings: 0,
    issues,
    truncated: false,
    preview,
    profile: {
      source: state.mode === "create" ? "selected-source" : "draft",
      declared: profiles.profiles.length,
      active: profiles.profiles.filter((profile) => profile.status === "active").length,
      unavailable: profiles.profiles.filter((profile) => profile.status === "unavailable").length,
      diagnostics: profiles.diagnostics.map((diagnostic) => ({
        namespace: diagnostic.namespace,
        ruleId: diagnostic.ruleId,
        level: diagnostic.level,
        path: diagnostic.file,
        conceptId: diagnostic.conceptId,
        field: diagnostic.field,
        message: diagnostic.message,
      })),
      truncated: profiles.truncated,
    },
  };
}

function mockStagedGraphPreview(state: ReturnType<typeof mockStageState>): AgentStagedValidationInfo["preview"] {
  const concepts = new Map<string, {
    id: string;
    title: string;
    conceptType: string;
    staged: boolean;
    links: string[];
    access: import("@/shared/access.ts").AccessHints;
  }>();
  if (state.mode !== "create") {
    for (const concept of MOCK_BUNDLE.concepts) {
      concepts.set(concept.id, {
        id: concept.id,
        title: concept.title,
        conceptType: concept.type,
        staged: false,
        links: [...concept.links],
        access: assessAccessHints(concept),
      });
    }
  }
  for (const file of state.files) {
    const lowerPath = file.path.toLowerCase();
    if (!lowerPath.endsWith(".md") || lowerPath.endsWith("index.md")) continue;
    const id = file.path.slice(0, -3).replaceAll("\\", "/");
    if (!file.hunkSelected) {
      if (file.kind === "create") concepts.delete(id);
      continue;
    }
    const titleMatch = /^#\s+(.+)$/m.exec(file.content);
    const typeMatch = /^type:\s*(.+)$/m.exec(file.content);
    const title = titleMatch?.[1]?.trim() ?? id.split("/").at(-1) ?? id;
    const conceptType = typeMatch?.[1]?.trim() ?? "";
    const access = assessAccessHints({ extra: mockAccessFrontmatter(file.content) });
    concepts.set(id, {
      id,
      title: title.slice(0, 256),
      conceptType: conceptType.slice(0, 256),
      staged: true,
      links: mockMarkdownConceptLinks(file.path, file.content),
      access,
    });
  }
  const ordered = [...concepts.values()].sort((left, right) =>
    Number(right.staged) - Number(left.staged) || left.id.localeCompare(right.id)
  );
  const includedNodes = ordered.slice(0, 128);
  const includedIds = new Set(includedNodes.map((node) => node.id));
  const allEdges = ordered.flatMap((node) => node.links.map((target) => ({
    source: node.id,
    target,
  })));
  const edges = allEdges
    .filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target))
    .slice(0, 512);
  return {
    nodes: includedNodes.map((node) => ({
      id: node.id,
      title: node.title,
      conceptType: node.conceptType,
      staged: node.staged,
      access: node.access,
    })),
    edges,
    totalNodes: ordered.length,
    totalEdges: allEdges.length,
    truncated: ordered.length > includedNodes.length || allEdges.length > edges.length,
  };
}

function mockAccessFrontmatter(content: string): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const key of ["audience", "sensitivity", "handling_notes"] as const) {
    const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(content);
    if (!match?.[1]) continue;
    const raw = match[1].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      extra[key] = raw.slice(1, -1)
        .split(",")
        .map((value) => value.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else {
      extra[key] = raw.replace(/^['"]|['"]$/g, "");
    }
  }
  return extra;
}

function mockMarkdownConceptLinks(sourcePath: string, content: string): string[] {
  const base = sourcePath.replaceAll("\\", "/").split("/").slice(0, -1);
  const links = new Set<string>();
  for (const match of content.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/gi)) {
    const href = match[1];
    if (!href || /^(?:[a-z]+:|\/)/i.test(href)) continue;
    const parts = [...base];
    for (const part of href.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    const path = parts.join("/");
    links.add(path.slice(0, -3));
  }
  return [...links];
}

export async function applyAgentStagedChanges(
  connectionId: string,
  sessionId: string,
  revision: string,
): Promise<AgentStagedApplyInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedApplyInfo>("apply_agent_staged_changes", {
      connectionId,
      sessionId,
      revision,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  if (state.mode === "create") {
    throw new Error(
      "Fresh bundle drafts cannot be applied to the active bundle. Choose a destination instead.",
    );
  }
  const validation = await validateAgentStagedChanges(connectionId, sessionId);
  if (validation.revision !== revision) {
    throw new Error("The staged changes or bundle files changed. Validate them again.");
  }
  if (validation.errors > 0) {
    throw new Error(
      `Apply blocked: staged validation found ${validation.errors} error${validation.errors === 1 ? "" : "s"}.`,
    );
  }
  const appliedFiles = state.files.filter((file) => file.hunkSelected).length;
  state.files = [];
  state.canRestore = appliedFiles > 0;
  const bundleRoot = mockAgentSessions.get(sessionId)?.bundleRoot;
  if (bundleRoot && appliedFiles > 0) mockBundleCheckpoints.set(bundleRoot, appliedFiles);
  const changes = emitMockStage(connectionId, sessionId);
  return { sessionId, revision, appliedFiles, changes };
}

export async function createAgentStagedBundle(
  connectionId: string,
  sessionId: string,
  revision: string,
  folderName: string,
): Promise<AgentStagedCreateInfo | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedCreateInfo | null>("create_agent_staged_bundle", {
      connectionId,
      sessionId,
      revision,
      folderName,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  validateMockBundleFolderName(folderName);
  const state = mockStageState(sessionId);
  if (state.mode !== "create") {
    throw new Error("Only a fresh bundle draft can create a new destination.");
  }
  const validation = await validateAgentStagedChanges(connectionId, sessionId);
  if (validation.revision !== revision) {
    throw new Error("The staged draft changed. Validate it again before creating the bundle.");
  }
  if (validation.errors > 0) {
    throw new Error(
      `Bundle creation blocked: staged validation found ${validation.errors} error${validation.errors === 1 ? "" : "s"}.`,
    );
  }
  const createdFiles = state.files.filter((file) => file.hunkSelected).length;
  if (createdFiles === 0) throw new Error("No selected draft files remain to create.");
  state.files = [];
  const changes = emitMockStage(connectionId, sessionId);
  return { sessionId, revision, folderName, createdFiles, changes };
}

function validateMockBundleFolderName(folderName: string): void {
  let characterCount = 0;
  let invalidCharacter = false;
  for (const character of folderName) {
    characterCount += 1;
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127 || '<>:"/\\|?*'.includes(character)) {
      invalidCharacter = true;
    }
  }
  const deviceStem = folderName.split(".", 1)[0]?.toUpperCase() ?? "";
  const reservedDevice = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceStem);
  if (
    folderName.length === 0 || characterCount > 128 ||
    folderName.trim() !== folderName || folderName === "." || folderName === ".." ||
    folderName.endsWith(".") || invalidCharacter
  ) {
    throw new Error(
      "Use a folder name of 1 to 128 characters without path separators, control characters, surrounding spaces, or reserved punctuation.",
    );
  }
  if (reservedDevice) {
    throw new Error("Choose a folder name that is portable across Windows, macOS, and Linux.");
  }
}

export async function restoreAgentStagedCheckpoint(
  connectionId: string,
  sessionId: string,
): Promise<AgentCheckpointRestoreInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentCheckpointRestoreInfo>("restore_agent_staged_checkpoint", {
      connectionId,
      sessionId,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  if (!state.canRestore) {
    throw new Error("There is no restorable checkpoint for this thread.");
  }
  if (state.files.length > 0) {
    throw new Error("Discard or apply the current staged changes before restoring.");
  }
  state.canRestore = false;
  const bundleRoot = mockAgentSessions.get(sessionId)?.bundleRoot;
  const restoredFiles = bundleRoot ? (mockBundleCheckpoints.get(bundleRoot) ?? 1) : 1;
  if (bundleRoot) mockBundleCheckpoints.delete(bundleRoot);
  const changes = emitMockStage(connectionId, sessionId);
  return { sessionId, restoredFiles, changes };
}

export async function discardAgentStagedFile(
  connectionId: string,
  sessionId: string,
  path: string,
): Promise<AgentStagedChangesInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentStagedChangesInfo>("discard_agent_staged_file", {
      connectionId,
      sessionId,
      path,
    });
  }
  if (!activeAgentConnectionsById.has(connectionId)) {
    throw new Error("Agent connection was not found.");
  }
  const state = mockStageState(sessionId);
  if (!state.files.some((candidate) => candidate.path === path)) {
    throw new Error("This file is not staged.");
  }
  state.files = state.files.filter((candidate) => candidate.path !== path);
  return emitMockStage(connectionId, sessionId);
}

/** Browser-mock agent write: `Stage: <path>` prompts stage one file. */
function mockStageWrite(info: AgentTurnInfo, text: string): string | null {
  if (!text.startsWith("Stage:")) return null;
  const state = mockStageState(info.sessionId);
  if (!state.granted) {
    return "Bundle write denied: writes require the Allow edits in this thread grant.";
  }
  const path = text.slice("Stage:".length).trim() || "proposals/draft.md";
  const content = path.endsWith("valid.md")
    ? `---\ntype: note\n---\n# Draft\n\nStaged by the browser mock for ${path}.`
    : `# Draft\n\nStaged by the browser mock for ${path}.`;
  const existing = state.files.find((file) => file.path === path);
  if (existing) {
    existing.content = `${existing.content}\n\nRevised.`;
    existing.bytes = existing.content.length;
    existing.hunkSelected = true;
    existing.hunkReviewed = false;
  } else {
    const conceptId = path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
    const kind = state.mode !== "create" && MOCK_BUNDLE.concepts.some(
      (concept) => concept.id === conceptId,
    ) ? "modify" : "create";
    state.files.push({
      path,
      bytes: content.length,
      kind,
      content,
      hunkSelected: true,
      hunkReviewed: false,
    });
  }
  emitMockStage(info.connectionId, info.sessionId);
  return `Browser ACP staged: ${path}`;
}

function mockBundleGeneration(info: AgentTurnInfo, text: string): string | null {
  if (!text.startsWith("Generate the newest reviewed `okf-proposal` into Studio staging now.")) {
    return null;
  }
  const state = mockStageState(info.sessionId);
  if (!state.granted) {
    return "Bundle generation denied: writes require the Allow edits in this thread grant.";
  }
  const generated: { path: string; content: string; kind: "create" | "modify" }[] =
    state.mode === "enhance" ? [
      {
        path: "product/overview.md",
        kind: "modify",
        content: "---\ntype: Product\n---\n# Overview\n\nExisting product facts, with a proposed evidence note.\n\nSee [New insight](new-insight.md).",
      },
      {
        path: "product/new-insight.md",
        kind: "create",
        content: "---\ntype: Insight\n---\n# New insight\n\nA proposed addition linked to [Overview](overview.md).",
      },
      {
        path: "enhancements/index.md",
        kind: "create",
        content: "---\nokf_version: 0.1\n---\n# Enhancements\n\n- [New insight](../product/new-insight.md)",
      },
    ] : [
    {
      path: "overview.md",
      kind: "create",
      content: "---\ntype: Product\n---\n# Product overview\n\nSee [Agent system](agent-system.md).",
    },
    {
      path: "agent-system.md",
      kind: "create",
      content: "---\ntype: Architecture\n---\n# Agent system\n\nA proposed architecture concept.",
    },
    {
      path: "index.md",
      kind: "create",
      content: "---\nokf_version: 0.1\n---\n# Generated knowledge\n\n- [Product overview](overview.md)\n- [Agent system](agent-system.md)",
    },
  ];
  for (const file of generated) {
    const existing = state.files.find((candidate) => candidate.path === file.path);
    if (existing) {
      existing.content = file.content;
      existing.bytes = file.content.length;
      existing.hunkSelected = true;
      existing.hunkReviewed = false;
    } else {
      state.files.push({
        path: file.path,
        bytes: file.content.length,
        kind: file.kind,
        content: file.content,
        hunkSelected: true,
        hunkReviewed: false,
      });
    }
  }
  emitMockStage(info.connectionId, info.sessionId);
  return `Generated ${generated.length} proposed files in Studio staging.`;
}

function mockAgentResponse(text: string, taskId?: OkfTaskId): string {
  if (text.startsWith("OKF delegated run ")) {
    const concepts = [...text.matchAll(/^- (.+)$/gmu)].map((match) => match[1]);
    return (
      `Reviewed ${concepts.length} concept(s) in this run.\n\n` +
      "```okf-artifact\n" +
      JSON.stringify({ schemaVersion: 1, kind: "health-report", items: concepts }) +
      "\n```"
    );
  }
  if (text.startsWith("OKF critic pass for ")) {
    const artifactId = /"artifactId"\s*:\s*"([^"]+)"/u.exec(text)?.[1] ?? "mock-artifact";
    const artifactRevision = Number(/"revision"\s*:\s*(\d+)/u.exec(text)?.[1] ?? "1");
    const bundleFingerprint = /"bundleFingerprint"\s*:\s*"([^"]+)"/u.exec(text)?.[1] ??
      "okf-health-revision-browser-mock";
    return "The bounded critic pass found no additional concern.\n\n```okf-critic\n" +
      JSON.stringify({
        schemaVersion: 1,
        artifactId,
        artifactRevision,
        bundleFingerprint,
        checks: [
          { category: "coverage", status: "checked", detail: "Declared scope was reviewed." },
          { category: "contradictions", status: "checked", detail: "No contradiction was found." },
          { category: "unsupported-claims", status: "checked", detail: "Cited claims were reviewed." },
          { category: "missed-relationships", status: "checked", detail: "Declared relationships were reviewed." },
        ],
        findings: [],
        limitations: [],
      }, null, 2) + "\n```";
  }
  if (text === "/compact") {
    return "## Context summary\n\n- The thread is reviewing the active OKF bundle.\n" +
      "- Tool locations may open only matching bundle concepts.\n" +
      "- Proposed writes still require staged review and Apply.";
  }
  if (taskId === "okf-create" || taskId === "okf-enrich") {
    if (text.includes("Malformed proposal")) {
      return "I could not serialize the structure.\n\n```okf-proposal\n{not json}\n```";
    }
    const enhancement = taskId === "okf-enrich";
    const proposal = enhancement ? {
      concepts: [
        {
          path: "product/overview.md",
          title: "Overview",
          type: "Product",
          links: ["product/new-insight.md"],
        },
        {
          path: "product/new-insight.md",
          title: "New insight",
          type: "Insight",
          links: ["product/overview.md"],
        },
      ],
      indexes: [{ path: "enhancements/index.md", concepts: ["product/new-insight.md"] }],
    } : {
      concepts: [
        {
          path: "overview.md",
          title: "Product overview",
          type: "Product",
          links: ["agent-system.md"],
        },
        {
          path: "agent-system.md",
          title: "Agent system",
          type: "Architecture",
          links: [],
        },
      ],
      indexes: [{ path: "index.md", concepts: ["overview.md", "agent-system.md"] }],
    };
    return "I inspected the available evidence and mapped a small structure for review.\n\n" +
      "```okf-proposal\n" +
      JSON.stringify(proposal, null, 2) +
      "\n```";
  }
  if (text.startsWith("Research this question across the active bundle")) {
    if (text.includes("Omit research sections")) {
      return "**Finding:** Missing required sections.";
    }
    return "**Finding:** The bundle documents its product and architecture decisions.\n\n" +
      "## Sources\n\n- [Product overview](product/overview.md)\n\n" +
      "## Inferences\n\nNone.";
  }
  if (text.startsWith("Assess this dataset documentation and propose a change plan")) {
    if (text.includes("Omit change sections")) {
      return "The requested change needs review.";
    }
    return "The change is bounded to the documented product scope.\n\n" +
      "## Change Plan\n\n1. Review the current definition.\n2. Update the documented scope.\n3. Run OKF validation.\n\n" +
      "## Affected Concepts\n\n- `product/overview.md` - update the product definition";
  }
  return `Browser ACP received: ${text}`;
}

async function emitMockTurn(
  info: AgentTurnInfo,
  text: string,
  taskContext?: { taskId: OkfTaskId },
): Promise<void> {
  const generatesBundle = text.startsWith(
    "Generate the newest reviewed `okf-proposal` into Studio staging now.",
  );
  const reportsChange = text.startsWith("Stage:") || generatesBundle;
  const changeState = reportsChange
    ? (mockStageState(info.sessionId).granted ? "staged" : "not-staged")
    : null;
  await browserMockDelay(0);
  emitAgentTurn({
    ...info,
    update: {
      kind: "plan",
      entries: [
        { content: "Inspect the bundle and attachments", priority: "high", status: "in-progress" },
        { content: "Draft the response", priority: "medium", status: "pending" },
      ],
    },
  });
  emitAgentTurn({
    ...info,
    update: {
      kind: "tool-call",
      toolCallId: `search-${info.turnId}`,
      title: generatesBundle
        ? "Generate staged bundle files"
        : reportsChange ? "Edit the bundle" : "Search the bundle",
      toolKind: reportsChange ? "edit" : "search",
      status: "in-progress",
      changeState,
      locations: reportsChange
        ? []
        : [
            { path: "product/overview.md", line: 12 },
            { path: "features/agent-panel.md", line: 49 },
          ],
      // Reported-change turns carry an inline diff so the Zed-style diff
      // body renders in browser dev mode and in tests.
      content: reportsChange
        ? [{
            kind: "diff",
            path: "product/overview.md",
            diff: "@@ -1,2 +1,2 @@\n The product overview.\n-The old scope line.\n+The revised scope line.\n",
            truncated: false,
          }]
        : null,
    },
  });
  emitAgentTurn({
    ...info,
    update: {
      kind: "usage",
      usedTokens: 2_400,
      contextWindowTokens: 128_000,
      cost: { amount: 0.04, currency: "USD" },
    },
  });
  const delaySteps = text.includes("Run a long investigation") ? 100 : 1;
  for (let step = 0; step < delaySteps; step += 1) {
    await browserMockDelay(100);
    if (mockCancelledTurns.has(info.turnId)) break;
  }
  if (mockCancelledTurns.has(info.turnId)) {
    emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
    mockCancelledTurns.delete(info.turnId);
    return;
  }
  if (text.includes("Edit:")) {
    const ruleKey = `${info.connectionId}\0${info.sessionId}\0write-bundle-files`;
    const remembered = mockThreadPermissionRules.get(ruleKey);
    const requestId = `permission-${crypto.randomUUID()}`;
    const optionId = remembered === "allow"
      ? "allow-once"
      : remembered === "reject"
        ? "reject-once"
        : await new Promise<string | null>((resolve) => {
            mockPermissionResponses.set(requestId, {
              turnId: info.turnId,
              optionIds: new Set(["allow-once", "reject-once"]),
              optionDecisions: new Map([
                ["allow-once", "allow"],
                ["reject-once", "reject"],
              ]),
              ruleKey,
              resolve,
            });
            emitAgentPermission({
              requestId,
              connectionId: info.connectionId,
              sessionId: info.sessionId,
              update: {
                kind: "requested",
                toolCallId: `tool-${info.turnId}`,
                title: "Write bundle files",
                options: [
                  { optionId: "allow-once", name: "Allow once", kind: "allow-once" },
                  { optionId: "reject-once", name: "Reject", kind: "reject-once" },
                ],
                canRemember: true,
              },
            });
          });
    if (remembered === undefined) {
      emitAgentPermission({
        requestId,
        connectionId: info.connectionId,
        sessionId: info.sessionId,
        update: { kind: "resolved", optionId },
      });
    }
    if (optionId === null || optionId === "reject-once") {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
  }
  const shouldFailOnce = text.includes("Fail once:") && !mockFailedOncePrompts.has(text);
  if (shouldFailOnce) mockFailedOncePrompts.add(text);
  if (text.includes("Fail:") || shouldFailOnce) {
    emitAgentTurn({
      ...info,
      update: {
        kind: "text",
        text: "The agent started a response before the connection failed.",
        messageId: `message-${info.turnId}`,
      },
    });
    emitAgentTurn({
      ...info,
      update: { kind: "failed", message: "The mock agent connection closed." },
    });
    return;
  }
  emitAgentTurn({
    ...info,
    update: {
      kind: "plan",
      entries: [
        { content: "Inspect the bundle and attachments", priority: "high", status: "completed" },
        { content: "Draft the response", priority: "medium", status: "in-progress" },
      ],
    },
  });
  emitAgentTurn({
    ...info,
    update: {
      kind: "tool-call",
      toolCallId: `search-${info.turnId}`,
      title: null,
      toolKind: null,
      status: "completed",
      locations: null,
      changeState,
      content: null,
    },
  });
  emitAgentTurn({
    ...info,
    update: {
      kind: "usage",
      usedTokens: text === "/compact" ? 18_000 : 4_200,
      contextWindowTokens: 128_000,
      cost: { amount: 0.08, currency: "USD" },
    },
  });
  const responseText = mockStageWrite(info, text) ?? mockBundleGeneration(info, text) ??
    mockAgentResponse(text, taskContext?.taskId);
  emitAgentTurn({
    ...info,
    update: {
      kind: "text",
      text: responseText,
      messageId: `message-${info.turnId}`,
    },
  });
  emitAgentTurn({
    ...info,
    update: {
      kind: "plan",
      entries: [
        { content: "Inspect the bundle and attachments", priority: "high", status: "completed" },
        { content: "Draft the response", priority: "medium", status: "completed" },
      ],
    },
  });
  emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "end-turn" } });
  const mockSession = mockAgentSessions.get(info.sessionId);
  if (mockSession) {
    mockSession.updatedAt = new Date().toISOString();
    mockSession.messages = [
      ...mockSession.messages,
      { role: "agent", text: responseText },
    ];
  }
}

async function emitMockLocalTool(
  info: AgentTurnInfo,
  index: number,
  title: string,
  toolKind: "read" | "search" | "edit",
  changeState: "staged" | null = null,
  beforeComplete?: () => void,
  succeeds = true,
): Promise<boolean> {
  const toolCallId = `local-tool-${info.turnId}-${index}`;
  emitAgentTurn({
    ...info,
    update: {
      kind: "tool-call",
      toolCallId,
      title,
      toolKind,
      status: "in-progress",
      locations: null,
      changeState: null,
      content: null,
    },
  });
  await browserMockDelay(100);
  if (mockCancelledTurns.has(info.turnId)) return false;
  beforeComplete?.();
  emitAgentTurn({
    ...info,
    update: {
      kind: "tool-call",
      toolCallId,
      title: null,
      toolKind: null,
      status: succeeds ? "completed" : "failed",
      locations: null,
      changeState,
      content: null,
    },
  });
  return true;
}

async function emitMockLocalTurn(
  info: AgentTurnInfo,
  text: string,
  sources: readonly AgentSourceInput[],
  taskContext?: { taskId: OkfTaskId },
): Promise<void> {
  await browserMockDelay(100);
  if (mockCancelledTurns.has(info.turnId)) {
    emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
    mockCancelledTurns.delete(info.turnId);
    return;
  }
  const loadsSkill = /\b(?:load|use)\b.*\bOKF\b.*\b(?:guidance|instructions?)\b/iu.test(text);
  const searchesBundle = /\b(?:search|inspect)\b.*\b(?:bundle|concepts?)\b/iu.test(text);
  const guidedWorkflow = taskContext !== undefined;
  const generatesBundle = text.startsWith(
    "Generate the newest reviewed `okf-proposal` into Studio staging now.",
  );
  let toolIndex = 0;
  if (loadsSkill) {
    const completed = await emitMockLocalTool(
      info,
      toolIndex,
      "Load OKF instructions",
      "read",
    );
    if (!completed) {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
    toolIndex += 1;
  }
  if (searchesBundle) {
    const completed = await emitMockLocalTool(
      info,
      toolIndex,
      "Search OKF bundle",
      "search",
    );
    if (!completed) {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
    toolIndex += 1;
  }
  if (sources.length > 0) {
    const inventoryCompleted = await emitMockLocalTool(
      info,
      toolIndex,
      "Inspect attached sources",
      "search",
    );
    if (!inventoryCompleted) {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
    toolIndex += 1;
    const readCompleted = await emitMockLocalTool(
      info,
      toolIndex,
      "Read attached source",
      "read",
    );
    if (!readCompleted) {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
    toolIndex += 1;
  }
  const generation = { response: null as string | null };
  if (generatesBundle) {
    const writeGranted = mockStageState(info.sessionId).granted;
    const generated = await emitMockLocalTool(
      info,
      toolIndex,
      "Propose staged bundle files",
      "edit",
      writeGranted ? "staged" : null,
      () => {
        generation.response = mockBundleGeneration(info, text);
      },
      writeGranted,
    );
    if (!generated) {
      emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
      mockCancelledTurns.delete(info.turnId);
      return;
    }
    if (writeGranted) {
      toolIndex += 1;
      const validated = await emitMockLocalTool(
        info,
        toolIndex,
        "Validate staged proposal",
        "search",
      );
      if (!validated) {
        emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "cancelled" } });
        mockCancelledTurns.delete(info.turnId);
        return;
      }
    }
  }
  const responseText = generation.response ?? (guidedWorkflow
    ? mockAgentResponse(text, taskContext.taskId)
    : loadsSkill && searchesBundle
    ? "Loaded packaged OKF instructions and found the Agent Panel concept at `features/agent-panel`."
    : loadsSkill
      ? "Loaded packaged OKF instructions."
      : searchesBundle
        ? "Found the Agent Panel concept at `features/agent-panel`."
        : sources.length > 0
          ? `Inspected ${sources.length} attached source${sources.length === 1 ? "" : "s"}, including ${sources[0]?.title ?? "the supplied evidence"}.`
        : mockAgentResponse(text));
  emitAgentTurn({
    ...info,
    update: { kind: "text", text: responseText, messageId: null },
  });
  emitAgentTurn({ ...info, update: { kind: "completed", stopReason: "end-turn" } });
  const mockSession = mockAgentSessions.get(info.sessionId);
  if (mockSession) {
    mockSession.updatedAt = new Date().toISOString();
    mockSession.messages = [...mockSession.messages, { role: "agent", text: responseText }];
  }
}

function emitAgentPermission(event: AgentPermissionEvent): void {
  for (const handler of agentPermissionHandlers) handler(event);
}

function emitAgentTurn(event: AgentTurnEvent): void {
  for (const handler of agentTurnHandlers) handler(event);
  // Mock parity with the Rust bus: the same classification, so a test that
  // waits on a milestone here is waiting on what the host would publish.
  const milestone = turnMilestoneFor(event);
  if (milestone) emitAgentMilestone(milestone);
}

function emitAgentAvailableCommands(event: AgentAvailableCommandsEvent): void {
  for (const handler of agentAvailableCommandsHandlers) handler(event);
}

export async function disconnectAgent(connectionId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const profileId = activeAgentConnectionsById.get(connectionId)?.profileId;
    const disconnected = await invoke<boolean>("disconnect_agent", { connectionId });
    if (disconnected) activeAgentConnectionsById.delete(connectionId);
    if (disconnected) publishAgentConnections();
    if (disconnected && profileId) forgetLastAgentConnection(profileId);
    return disconnected;
  }
  const info = activeAgentConnectionsById.get(connectionId);
  if (!info) return false;
  activeAgentConnectionsById.delete(connectionId);
  forgetLastAgentConnection(info.profileId);
  clearMockThreadPermissionRules(connectionId);
  emitMockAgentConnection({
    connectionId,
    profileId: info.profileId,
    status: "disconnected",
    message: null,
  });
  return true;
}

export async function onAgentConnectionState(
  handler: AgentConnectionHandler,
): Promise<() => void> {
  if (!isTauri()) {
    agentConnectionHandlers.add(handler);
    return () => agentConnectionHandlers.delete(handler);
  }
  agentConnectionHandlers.add(handler);
  agentConnectionListener ??= listenAgentChannel("agent-connection-state", (data) =>
    receiveAgentConnectionEvent(data as AgentConnectionEvent),
  );
  try {
    await agentConnectionListener;
  } catch (error: unknown) {
    agentConnectionListener = undefined;
    agentConnectionHandlers.delete(handler);
    throw error;
  }
  return () => agentConnectionHandlers.delete(handler);
}

function emitMockAgentConnection(event: AgentConnectionEvent): void {
  receiveAgentConnectionEvent(event);
}

function receiveAgentConnectionEvent(event: AgentConnectionEvent): void {
  activeAgentConnectionsById.delete(event.connectionId);
  publishAgentConnections();
  for (const handler of agentConnectionHandlers) handler(event);
}

function forgetProfileConnections(profileId: string): void {
  let didChange = false;
  for (const [connectionId, info] of activeAgentConnectionsById) {
    if (info.profileId !== profileId) continue;
    activeAgentConnectionsById.delete(connectionId);
    didChange = true;
  }
  if (didChange) publishAgentConnections();
}

function publishAgentConnections(): void {
  activeAgentConnectionSnapshot = [...activeAgentConnectionsById.values()];
  for (const subscriber of activeAgentConnectionSubscribers) subscriber();
}

export async function agentInstallPreflight(
  agentId: string,
): Promise<AgentInstallPreflight> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentInstallPreflight>("agent_install_preflight", { agentId });
  }

  const document = catalog as AgentCatalogDocument;
  const entry = document.entries.find((candidate) => candidate.id === agentId);
  if (!entry?.distribution) throw new Error("This agent is not installable yet.");
  if (entry.distribution.kind === "binary") {
    const targets: Readonly<Partial<Record<string, AgentBinaryTarget>>> =
      entry.distribution.targets;
    const target = targets[browserTarget()];
    if (!target) {
      throw new Error(`${entry.name} does not publish a build for ${browserTarget()}.`);
    }
    const packageDownloadSize = mockInstalledAgents.has(agentId) ? 0 : target.downloadSize;
    return {
      agentId,
      agentVersion: entry.distribution.version,
      kind: "binary",
      target: browserTarget(),
      runtimeVersion: "",
      packageDownloadSize,
      runtimeDownloadSize: 0,
      totalDownloadSize: packageDownloadSize,
      packageInstalled: mockInstalledAgents.has(agentId),
      runtimeInstalled: true,
    };
  }
  const runtime = document.nodeRuntime.distributions.find(
    (distribution) => distribution.target === browserTarget(),
  );
  if (!runtime) throw new Error("Managed Node is not available on this platform.");
  return {
    agentId,
    agentVersion: entry.distribution.version,
    kind: "npm",
    target: runtime.target,
    runtimeVersion: document.nodeRuntime.version,
    packageDownloadSize: entry.distribution.downloadSize,
    runtimeDownloadSize: runtime.downloadSize,
    totalDownloadSize: entry.distribution.downloadSize + runtime.downloadSize,
    packageInstalled: mockInstalledAgents.has(agentId),
    runtimeInstalled: false,
  };
}

type AgentInstallProgressHandler = (progress: AgentInstallProgress) => void;

const mockInstallProgressHandlers = new Set<AgentInstallProgressHandler>();
const mockCancelledInstalls = new Set<string>();
const mockInstalledAgents = new Set<string>();

export async function onAgentInstallProgress(
  handler: AgentInstallProgressHandler,
): Promise<() => void> {
  if (!isTauri()) {
    mockInstallProgressHandlers.add(handler);
    return () => mockInstallProgressHandlers.delete(handler);
  }

  const { listen } = await import("@tauri-apps/api/event");
  return listen<AgentInstallProgress>("agent-install-progress", (event) =>
    handler(event.payload),
  );
}

export async function installAgent(
  agentId: string,
  installId: string,
): Promise<AgentInstallReceipt> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentInstallReceipt>("install_agent", { agentId, installId });
  }

  const preflight = await agentInstallPreflight(agentId);
  const phases: AgentInstallProgress["phase"][] = preflight.kind === "binary"
    ? ["package-downloading", "package-extracting", "complete"]
    : [
        "runtime-downloading",
        "runtime-extracting",
        "package-downloading",
        "package-extracting",
        "dependencies-installing",
        "complete",
      ];
  mockCancelledInstalls.delete(installId);

  for (const phase of phases) {
    await browserMockDelay(40);
    if (mockCancelledInstalls.has(installId)) {
      emitMockInstallProgress({
        installId,
        agentId,
        phase: "cancelled",
        downloadedBytes: 0,
        totalBytes: preflight.totalDownloadSize,
      });
      throw new Error("Installation cancelled.");
    }
    emitMockInstallProgress({
      installId,
      agentId,
      phase,
      downloadedBytes: phase === "complete" ? preflight.totalDownloadSize : 0,
      totalBytes: preflight.totalDownloadSize,
    });
  }

  const entry = (catalog as AgentCatalogDocument).entries.find(
    (candidate) => candidate.id === agentId,
  );
  if (!entry?.distribution) throw new Error("This agent is not installable yet.");
  mockInstalledAgents.add(agentId);
  const binaryTarget: AgentBinaryTarget | undefined =
    entry.distribution.kind === "binary"
      ? entry.distribution.targets[browserTarget()]
      : undefined;
  return {
    agentId,
    version: entry.distribution.version,
    packageDir: `mock-agent-cache/${agentId}/${entry.distribution.version}`,
    integrity: entry.distribution.kind === "npm"
      ? entry.distribution.integrity
      : `sha256-${binaryTarget?.sha256 ?? "mock"}`,
    dependencyLockSha256: entry.distribution.kind === "npm" ? "mock-dependency-lock-sha256" : "",
    entrypointSha256: "mock-entrypoint-sha256",
    alreadyInstalled: false,
    kind: entry.distribution.kind,
  };
}

export async function cancelAgentInstall(installId: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("cancel_agent_install", { installId });
  }
  mockCancelledInstalls.add(installId);
  return true;
}

export async function uninstallAgent(agentId: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("uninstall_agent", { agentId });
    return;
  }
  const profileId = `catalog-${agentId}`;
  if (activeAgentConnectionSnapshot.some((info) => info.profileId === profileId)) {
    throw new Error("Disconnect this agent before removing it.");
  }
  await browserMockDelay(40);
  mockInstalledAgents.delete(agentId);
}

function emitMockInstallProgress(progress: AgentInstallProgress): void {
  for (const handler of mockInstallProgressHandlers) handler(progress);
}

function browserTarget(): string {
  const userAgent = navigator.userAgent.toLowerCase();
  const arch = userAgent.includes("arm64") || userAgent.includes("aarch64")
    ? "aarch64"
    : "x86_64";
  if (userAgent.includes("windows")) return `windows-${arch}`;
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) {
    return `macos-${arch}`;
  }
  return `linux-${arch}`;
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return MOCK_FOLDER;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_bundle_folder");
}

/** Inputs for the static new-bundle generator (no agent involved). */
export interface CreateBundleInput {
  folderName: string;
  title: string;
  description: string;
  firstConceptTitle: string;
  firstConceptType: string;
  includeGuide: boolean;
}

/**
 * Create a conformant starter bundle: Rust shows the OS parent-folder picker,
 * writes the generated tree atomically, self-checks it with okf-core, and
 * grants the new folder. Resolves the created folder, or null on cancel.
 * In a browser the mock "creates" the sample bundle so the flow is drivable.
 */
export async function createBundle(input: CreateBundleInput): Promise<string | null> {
  if (!isTauri()) return MOCK_FOLDER;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("create_bundle", { input });
}

/** Remove one exact Rust-owned folder grant. Frontend state cannot add one. */
export async function revokeBundleGrant(folder: string): Promise<boolean> {
  if (!isTauri()) return true;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("revoke_bundle_grant", { folder });
}

/**
 * Fetch a remote bundle source into a local cache directory and return that
 * directory's path — which the caller then treats exactly like a picked folder
 * (scan → open → watch → recents). Remote retrieval begins only after the user
 * chooses Open or Refresh; the Rust command applies https-only, size-cap, and
 * archive-extraction containment guards. Other Studio network operations have
 * their own explicit actions and boundaries. Off-Tauri this resolves to the mock
 * folder after a short delay, so the dialog's fetch progress is exercised in dev.
 */
export async function fetchRemoteBundle(
  source: RemoteSource,
): Promise<{ folder: string }> {
  if (!isTauri()) {
    await browserMockDelay(600);
    return { folder: MOCK_FOLDER };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const folder = await invoke<string>("fetch_remote_bundle", { source });
  return { folder };
}

export async function scanBundles(
  folder: string,
  maxDepth = 8,
): Promise<BundleRoot[]> {
  if (!isTauri()) return MOCK_ROOTS;
  const { invoke } = await import("@tauri-apps/api/core");
  // Tauri maps `maxDepth` to the command's `max_depth` argument.
  return invoke<BundleRoot[]>("scan_bundles", { folder, maxDepth });
}

export async function readBundle(root: string): Promise<Bundle> {
  if (!isTauri()) return MOCK_BUNDLE;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Bundle>("read_bundle", { root });
}

function mockCompatibilityReport(): CompatibilityReport {
  const findings: CompatibilityFinding[] = MOCK_BUNDLE.issues.map((issue) => ({
    ruleId: issue.message.includes("link target not found")
      ? "okf.conformance.link-target"
      : "okf.conformance.parser",
    category: issue.message.includes("link target not found") ? "link" : "parser",
    level: issue.level,
    basis: "okf-conformance",
    file: issue.message.split(":", 1)[0] || `${issue.conceptId ?? "bundle"}.md`,
    conceptId: issue.conceptId,
    message: issue.message,
    repair: null,
  }));
  findings.push({
    ruleId: "okf.portability.relative-link",
    category: "link",
    level: "advice",
    basis: "portability",
    file: "product/overview.md",
    conceptId: "product/overview",
    message: "Bundle-absolute link /features/graph-view.md resolves in Studio but a relative target travels more reliably between OKF consumers.",
    repair: {
      kind: "replace-markdown-target",
      authored: "/features/graph-view.md",
      replacement: "../features/graph-view.md",
    },
  });
  const extension = MOCK_BUNDLE.concepts.find((concept) => Object.keys(concept.extra).length > 0);
  if (extension) {
    findings.push({
      ruleId: "okf.extensions.preserved",
      category: "extension",
      level: "information",
      basis: "preservation",
      file: `${extension.id}.md`,
      conceptId: extension.id,
      message: `Studio preserved producer-defined frontmatter: ${Object.keys(extension.extra).join(", ")}.`,
      repair: null,
    });
  }
  return { schemaVersion: 1, findings, truncated: false };
}

export async function readCompatibilityReport(bundleRoot: string): Promise<CompatibilityReport> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return mockCompatibilityReport();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CompatibilityReport>("okf_compatibility_report", { bundleRoot });
}

export async function readIgnoreReport(bundleRoot: string): Promise<IgnoreReport> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return {
      schemaVersion: 1,
      source: ".okfignore",
      ruleCount: 3,
      caseSensitive: true,
      excludedCount: 4,
      excludedPaths: [
        "drafts/private-notes.md",
        "generated/cache.md",
        "private/source-dump.json",
        "tmp/research.md",
      ],
      diagnostics: [],
      truncated: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<IgnoreReport>("okf_ignore_report", { bundleRoot });
}

function mockProfileReport(): ProfileReport {
  return {
    schemaVersion: 1,
    profiles: [{
      namespace: "com.example.knowledge",
      version: "1.2.0",
      descriptorPath: "profiles/com.example.knowledge.json",
      status: "active",
      message: "Resolved from a version-pinned descriptor inside this bundle.",
      extra: { mode: "advisory" },
      descriptor: {
        schemaVersion: 1,
        namespace: "com.example.knowledge",
        version: "1.2.0",
        title: "Team knowledge",
        description: "Shared conventions for maintained product knowledge.",
        fields: [{
          id: "owner",
          scope: "concept",
          key: "owner",
          label: "Owner",
          description: "The team responsible for this concept.",
          valueType: "string",
          expectation: "recommended",
          conceptTypes: [],
          examples: ["Docs"],
        }],
        relationships: [{
          id: "supports",
          label: "Supports",
          inverse: "supported-by",
          description: "This concept provides evidence or implementation support.",
        }],
        checks: [{
          kind: "field-present",
          id: "owner-present",
          scope: "concept",
          field: "owner",
          level: "recommendation",
          message: "Name the team responsible for this concept.",
          conceptTypes: ["Product"],
        }],
      },
    }],
    diagnostics: [{
      namespace: "com.example.knowledge",
      ruleId: "owner-present",
      level: "recommendation",
      scope: "concept",
      file: "product/overview.md",
      conceptId: "product/overview",
      field: "owner",
      message: "Name the team responsible for this concept.",
    }],
    edges: [{
      sourceId: "product/overview",
      targetId: "features/graph-view",
      namespace: "com.example.knowledge",
      type: "supports",
      label: "Supports",
      inverse: "supported-by",
      recognized: true,
      targetExists: true,
      portableLink: true,
    }, {
      sourceId: "product/overview",
      targetId: "reference/glossary",
      namespace: "com.example.knowledge",
      type: "producer-relation",
      label: "producer-relation",
      inverse: null,
      recognized: false,
      targetExists: true,
      portableLink: true,
    }],
    truncated: false,
  };
}

export async function readProfileReport(bundleRoot: string): Promise<ProfileReport> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return mockProfileReport();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProfileReport>("okf_profile_report", { bundleRoot });
}

function mockProjectionPlan(input: ProjectionInput): ProjectionPlan {
  const byId = new Map(MOCK_BUNDLE.concepts.map((concept) => [concept.id, concept]));
  const audiences = new Set(input.recipientAudiences.map((value) => value.toLocaleLowerCase()));
  const maximum = ["public", "internal", "confidential", "restricted"]
    .indexOf(input.maxSensitivity);
  const included = new Map<string, ProjectionPlan["included"][number]>();
  const omittedReasons = new Map<string, ProjectionPlan["omissions"][number]["reason"]>();
  const queue = input.selectedConceptIds.map((id) => ({ id, linkedFrom: null as string | null }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || included.has(next.id) || omittedReasons.has(next.id)) continue;
    const concept = byId.get(next.id);
    if (!concept) continue;
    const access = assessAccessHints(concept);
    const sensitivity = access.knownSensitivity
      ? ["public", "internal", "confidential", "restricted"].indexOf(access.knownSensitivity)
      : -1;
    const audienceMismatch = audiences.size > 0 && access.audiences.length > 0 &&
      !access.audiences.some((value) => audiences.has(value.toLocaleLowerCase()));
    if (audienceMismatch) {
      omittedReasons.set(concept.id, "audience-mismatch");
      continue;
    }
    if (
      access.sensitivity !== null &&
      access.knownSensitivity === null &&
      !input.includeUnknownSensitivity
    ) {
      omittedReasons.set(concept.id, "unknown-sensitivity");
      continue;
    }
    if (access.sensitivity === null && !input.includeUnknownSensitivity) {
      omittedReasons.set(concept.id, "unknown-sensitivity");
      continue;
    }
    if (sensitivity > maximum) {
      omittedReasons.set(concept.id, "sensitivity-exceeds-maximum");
      continue;
    }
    included.set(concept.id, {
      id: concept.id,
      title: concept.title,
      reason: next.linkedFrom === null ? "explicit" : "transitive-link",
      linkedFrom: next.linkedFrom,
      access,
    });
    for (const id of concept.links) queue.push({ id, linkedFrom: concept.id });
  }
  for (const concept of MOCK_BUNDLE.concepts) {
    if (!included.has(concept.id) && !omittedReasons.has(concept.id)) {
      omittedReasons.set(concept.id, "not-selected");
    }
  }
  const omissions: ProjectionPlan["omissions"] = MOCK_BUNDLE.concepts
    .filter((concept) => omittedReasons.has(concept.id))
    .map((concept) => ({
      kind: "concept",
      id: concept.id,
      title: concept.title,
      reason: omittedReasons.get(concept.id) ?? "not-selected",
    }));
  omissions.push({
    kind: "ignored-path",
    id: "drafts/private-notes.md",
    title: "drafts/private-notes.md",
    reason: "ignored-by-rule",
  });
  const includedIds = new Set(included.keys());
  const linkConsequences: ProjectionPlan["linkConsequences"] = [];
  for (const concept of MOCK_BUNDLE.concepts.filter((item) => includedIds.has(item.id))) {
    for (const target of concept.links.filter((id) => !includedIds.has(id))) {
      linkConsequences.push({
        sourceId: concept.id,
        target,
        outcome: "rewritten-omitted",
        occurrences: 1,
      });
    }
    for (const target of concept.brokenLinks) {
      linkConsequences.push({
        sourceId: concept.id,
        target,
        outcome: "existing-broken",
        occurrences: 1,
      });
    }
  }
  const redactions = input.sensitiveTerms.flatMap((value) =>
    MOCK_BUNDLE.concepts
      .filter((concept) => includedIds.has(concept.id))
      .map((concept) => ({
        file: `${concept.id}.md`,
        category: "user-sensitive-term",
        value,
        occurrences: concept.body.toLocaleLowerCase().split(value.toLocaleLowerCase()).length - 1,
      }))
      .filter((item) => item.occurrences > 0)
  );
  const safeRecipient = input.recipient.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "recipient";
  const signature = [
    input.recipient,
    ...input.selectedConceptIds,
    ...input.recipientAudiences,
    input.maxSensitivity,
    String(input.includeUnknownSensitivity),
    ...input.sensitiveTerms,
  ].join("|");
  let hash = 2_166_136_261;
  for (const character of signature) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return {
    schemaVersion: 1,
    revision: `okf-projection-mock-${(hash >>> 0).toString(16)}`,
    sourceBundleFingerprint: "mock-bundle-fingerprint",
    recipient: input.recipient,
    recipientAudiences: input.recipientAudiences,
    maxSensitivity: input.maxSensitivity,
    includeUnknownSensitivity: input.includeUnknownSensitivity,
    destinationFolderName: `${safeRecipient}-okf`,
    included: [...included.values()],
    omissions,
    linkConsequences,
    redactions,
    ignoredRuleCount: 3,
    ignoredPathsTruncated: false,
    warnings: included.size === 0 ? ["No selected concept passed the reviewed constraints."] : [],
  };
}

export async function planOkfProjection(
  bundleRoot: string,
  input: ProjectionInput,
): Promise<ProjectionPlan> {
  if (!isTauri()) {
    await browserMockDelay(80);
    return mockProjectionPlan(input);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectionPlan>("okf_projection_plan", { bundleRoot, input });
}

export async function exportOkfProjection(
  bundleRoot: string,
  input: ProjectionExportInput,
): Promise<ProjectionExportResult | null> {
  if (!isTauri()) {
    await browserMockDelay(120);
    const plan = mockProjectionPlan(input.projection);
    if (plan.revision !== input.planRevision) {
      throw new Error("The source bundle or projection choices changed. Review a refreshed plan.");
    }
    return {
      schemaVersion: 1,
      status: "exported",
      destination: `/mock/exports/${plan.destinationFolderName}`,
      destinationFolderName: plan.destinationFolderName,
      auditReport: `/mock/exports/${plan.destinationFolderName}.erasure-audit.json`,
      audit: {
        schemaVersion: 1,
        passed: true,
        checkedFiles: plan.included.length + 3,
        checkedBytes: 18_640,
        checkedTerms: plan.omissions.length + input.projection.sensitiveTerms.length,
        findings: [],
        truncated: false,
        diagnostics: [],
      },
      validation: { errors: 0, warnings: 0, issues: [], truncated: false },
      sourceUnchanged: true,
      replacedExistingProjection: input.overwriteConfirmed,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProjectionExportResult | null>("export_okf_projection", { bundleRoot, input });
}

function mockInteropReport(): InteropReport {
  return {
    schemaVersion: 1,
    multilingual: {
      groups: [{
        identity: "product/overview",
        variants: [{
          conceptId: "product/overview",
          title: "Overview",
          language: "en",
          convention: "frontmatter",
          translationOf: null,
          targetExists: true,
        }, {
          conceptId: "product/overview.de",
          title: "Überblick",
          language: "de",
          convention: "translation-reference",
          translationOf: "product/overview",
          targetExists: true,
        }],
      }],
      conventions: [{
        convention: "frontmatter",
        observed: 1,
        strengths: ["Keeps filenames stable."],
        gaps: ["A language field alone does not identify sibling variants."],
      }, {
        convention: "filename-suffix",
        observed: 0,
        strengths: ["Variant identity is visible without parsing frontmatter."],
        gaps: ["Renaming the base path can split a set."],
      }, {
        convention: "translation-reference",
        observed: 1,
        strengths: ["Variants keep ordinary concept identities and an explicit base reference."],
        gaps: ["Safe move does not rewrite the producer-defined reference yet."],
      }],
      adoptionReady: false,
      message: "Variants remain an experiment until link, search, retrieval, move, and projection fixtures pass together.",
    },
    externalBundles: [{
      alias: "upstream",
      url: "https://github.com/GoogleCloudPlatform/knowledge-catalog",
      expectedDigest: null,
      cachePath: null,
      status: "not-resolved",
      cachedDigest: null,
      identityPrefix: "external:upstream:",
      message: "Not fetched. Resolution begins only from the named user action.",
    }],
    semanticWeb: {
      exportableRelationships: 8,
      unsupportedRelationships: 2,
      message: "JSON-LD exchange covers typed relationships backed by portable Markdown links; every other construct is reported as loss.",
    },
    sidecars: [{
      conceptId: "product/overview",
      path: "assets/example.notebook",
      mediaType: "application/x-ipynb+json",
      authoredDigest: null,
      actualDigest: "sha256:mock-sidecar",
      size: 14_280,
      status: "ready",
      openPolicy: "download-only",
      message: "The file remains exportable but Studio will not execute or render it.",
    }],
    diagnostics: [],
    truncated: false,
  };
}

export async function readInteropReport(bundleRoot: string): Promise<InteropReport> {
  if (!isTauri()) {
    await browserMockDelay(60);
    return mockInteropReport();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<InteropReport>("okf_interop_report", { bundleRoot });
}

export async function exportSemanticWeb(bundleRoot: string): Promise<string | null> {
  if (!isTauri()) {
    await browserMockDelay(80);
    return "okf-studio-sample-relationships.jsonld";
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("export_semantic_web", { bundleRoot });
}

export async function importSemanticWeb(): Promise<SemanticImportPreview | null> {
  if (!isTauri()) {
    await browserMockDelay(80);
    return {
      schemaVersion: 1,
      relationships: [{
        sourceId: "product/overview",
        targetId: "features/graph-view",
        namespace: "com.example.knowledge",
        type: "supports",
      }],
      losses: [{
        path: "@graph[4]",
        message: "An OWL restriction is outside the declared relationship subset.",
      }],
      truncated: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SemanticImportPreview | null>("import_semantic_web");
}

export async function exportOkfSidecar(
  bundleRoot: string,
  conceptId: string,
  path: string,
): Promise<string | null> {
  if (!isTauri()) {
    await browserMockDelay(80);
    return path.split("/").pop() ?? "sidecar";
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("export_okf_sidecar", { bundleRoot, conceptId, path });
}

export interface CompatibilityReview {
  staged: AgentStagedChangesInfo;
  diff: AgentStagedFileDiff;
}

export interface ConceptMoveChange {
  path: string;
  kind: "create" | "modify" | "delete";
  reason: string;
}

export interface ConceptMovePlan {
  schemaVersion: 1;
  sourceId: string;
  destinationId: string;
  stableId: string | null;
  affectedLinks: number;
  affectedIndexes: number;
  warnings: string[];
  changes: ConceptMoveChange[];
}

export interface ConceptMoveReview {
  plan: ConceptMovePlan;
  staged: AgentStagedChangesInfo;
}

export type RetirementAction = "deprecate" | "redirect" | "tombstone" | "delete";

export interface ConceptRetirementPlan {
  schemaVersion: 1;
  sourceId: string;
  action: RetirementAction;
  replacementId: string | null;
  affectedLinks: number;
  affectedIndexes: number;
  retrievalConsequence: string;
  warnings: string[];
  changes: ConceptMoveChange[];
}

export interface ConceptRetirementReview {
  plan: ConceptRetirementPlan;
  staged: AgentStagedChangesInfo;
}

let mockCompatibilityDiff: AgentStagedFileDiff | null = null;
let mockCompatibilityCanRestore = false;
let mockConceptMoveDiffs = new Map<string, AgentStagedFileDiff>();
let mockConceptMoveCanRestore = false;

export async function stageCompatibilityNormalization(
  bundleRoot: string,
  finding: CompatibilityFinding,
): Promise<CompatibilityReview> {
  if (!finding.repair) throw new Error("This compatibility finding has no safe normalization.");
  if (!isTauri()) {
    await browserMockDelay(40);
    mockCompatibilityDiff = {
      path: finding.file,
      kind: "modify",
      revision: "mock-compatibility-diff-1",
      hunks: [{
        index: 0,
        header: "@@ -12,1 +12,1 @@",
        unified: `-[Graph](${finding.repair.authored})\n+[Graph](${finding.repair.replacement})`,
        selected: true,
        reviewed: false,
      }],
      truncated: false,
    };
    return {
      staged: mockCompatibilityChanges(false),
      diff: structuredClone(mockCompatibilityDiff),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<CompatibilityReview>("stage_compatibility_normalization", {
    bundleRoot,
    file: finding.file,
    ruleId: finding.ruleId,
    authored: finding.repair.authored,
  });
}

export async function selectCompatibilityHunk(
  bundleRoot: string,
  path: string,
  revision: string,
  hunkIndex: number,
  selected: boolean,
): Promise<AgentStagedFileDiff> {
  if (!isTauri()) {
    await browserMockDelay(20);
    if (mockCompatibilityDiff?.revision !== revision) {
      throw new Error("The staged diff changed. Review the file again.");
    }
    mockCompatibilityDiff = {
      ...mockCompatibilityDiff,
      hunks: mockCompatibilityDiff.hunks.map((hunk) => hunk.index === hunkIndex
        ? { ...hunk, selected, reviewed: true }
        : hunk),
    };
    return structuredClone(mockCompatibilityDiff);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedFileDiff>("select_compatibility_hunk", {
    bundleRoot,
    path,
    revision,
    hunkIndex,
    selected,
  });
}

export async function validateCompatibilityNormalization(
  bundleRoot: string,
): Promise<AgentStagedValidationInfo> {
  if (!isTauri()) {
    await browserMockDelay(40);
    if (!mockCompatibilityDiff?.hunks.every((hunk) => hunk.reviewed)) {
      throw new Error("Review every staged hunk before validation.");
    }
    return {
      sessionId: "compatibility-clinic-mock",
      revision: "mock-compatibility-selected-1",
      errors: 0,
      warnings: 0,
      issues: [],
      truncated: false,
      preview: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, truncated: false },
      profile: {
        source: "draft",
        declared: 0,
        active: 0,
        unavailable: 0,
        diagnostics: [],
        truncated: false,
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedValidationInfo>("validate_compatibility_normalization", { bundleRoot });
}

export async function applyCompatibilityNormalization(
  bundleRoot: string,
  revision: string,
): Promise<AgentStagedApplyInfo> {
  if (!isTauri()) {
    await browserMockDelay(40);
    mockCompatibilityDiff = null;
    mockCompatibilityCanRestore = true;
    return {
      sessionId: "compatibility-clinic-mock",
      revision,
      appliedFiles: 1,
      changes: mockCompatibilityChanges(true),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedApplyInfo>("apply_compatibility_normalization", { bundleRoot, revision });
}

export async function discardCompatibilityNormalization(
  bundleRoot: string,
): Promise<AgentStagedChangesInfo> {
  if (!isTauri()) {
    await browserMockDelay(20);
    mockCompatibilityDiff = null;
    return mockCompatibilityChanges(mockCompatibilityCanRestore);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedChangesInfo>("discard_compatibility_normalization", { bundleRoot });
}

export async function restoreCompatibilityNormalization(
  bundleRoot: string,
): Promise<AgentCheckpointRestoreInfo> {
  if (!isTauri()) {
    await browserMockDelay(40);
    mockCompatibilityCanRestore = false;
    return {
      sessionId: "compatibility-clinic-mock",
      restoredFiles: 1,
      changes: mockCompatibilityChanges(false),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentCheckpointRestoreInfo>("restore_compatibility_normalization", { bundleRoot });
}

export async function stageConceptMove(
  bundleRoot: string,
  sourceId: string,
  destinationPath: string,
): Promise<ConceptMoveReview> {
  if (!isTauri()) {
    await browserMockDelay(40);
    const destinationId = destinationPath.trim().replaceAll("\\", "/").replace(/\.md$/iu, "");
    if (!destinationId || destinationId === sourceId) {
      throw new Error("Choose a different bundle-relative .md path.");
    }
    const changes: ConceptMoveChange[] = [
      { path: `${sourceId}.md`, kind: "modify", reason: "Keep portable redirect" },
      { path: destinationPath, kind: "create", reason: "Create destination" },
      { path: "index.md", kind: "modify", reason: "Update navigation" },
    ];
    mockConceptMoveDiffs = new Map(changes.map((change, index) => [
      change.path,
      {
        path: change.path,
        kind: change.kind,
        revision: `mock-move-diff-${index}`,
        hunks: [{
          index: 0,
          header: "@@ -1,1 +1,1 @@",
          unified: change.kind === "create"
            ? `+---\n+type: Guide\n+---\n+# Moved concept\n`
            : `-[Old](${sourceId}.md)\n+[Moved](${destinationId}.md)\n`,
          selected: true,
          reviewed: false,
        }],
        truncated: false,
      },
    ]));
    return {
      plan: {
        schemaVersion: 1,
        sourceId,
        destinationId,
        stableId: "concept-stable-01",
        affectedLinks: 2,
        affectedIndexes: 1,
        warnings: [],
        changes,
      },
      staged: {
        sessionId: "concept-move-mock",
        granted: true,
        grantMode: "interactive",
        mode: "enhance",
        canRestore: mockConceptMoveCanRestore,
        files: changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          bytes: 180,
        })),
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ConceptMoveReview>("stage_concept_move", {
    bundleRoot,
    sourceId,
    destinationPath,
  });
}

export async function stageConceptRetirement(
  bundleRoot: string,
  request: {
    sourceId: string;
    action: RetirementAction;
    replacementId: string | null;
    reason: string;
    decisionDate: string;
  },
): Promise<ConceptRetirementReview> {
  if (!isTauri()) {
    await browserMockDelay(40);
    const sourcePath = `${request.sourceId}.md`;
    const requestedReplacement = request.replacementId?.trim();
    const replacementId = requestedReplacement && requestedReplacement.length > 0
      ? requestedReplacement
      : null;
    if (!request.reason.trim()) {
      throw new Error("Name a bounded plain-text retirement reason.");
    }
    if (request.action === "redirect" && !replacementId) {
      throw new Error("Redirect requires a replacement concept.");
    }
    const changes: ConceptMoveChange[] = [
      {
        path: sourcePath,
        kind: request.action === "delete" ? "delete" : "modify",
        reason: request.action === "deprecate"
          ? "Mark deprecated"
          : request.action === "redirect"
            ? "Keep portable redirect"
            : request.action === "tombstone"
              ? "Keep retirement tombstone"
              : "Delete concept file",
      },
      ...(request.action === "redirect" || request.action === "delete"
        ? [{ path: "index.md", kind: "modify" as const, reason: "Update navigation" }]
        : []),
      { path: "log.md", kind: "modify", reason: "Record retirement decision" },
    ];
    const replacement = replacementId ?? "replacement-concept";
    mockConceptMoveDiffs = new Map(changes.map((change, index) => [
      change.path,
      {
        path: change.path,
        kind: change.kind,
        revision: `mock-retirement-diff-${index}`,
        hunks: [{
          index: 0,
          header: "@@ -1,3 +1,3 @@",
          unified: change.kind === "delete"
            ? `----\n-type: Feature\n----\n-# Retired concept\n`
            : change.path === "log.md"
              ? `+* **Retirement**: ${request.action} \`${request.sourceId}\`.\n`
              : `-[Retired](${sourcePath})\n+[Replacement](${replacement}.md)\n`,
          selected: true,
          reviewed: false,
        }],
        truncated: false,
      },
    ]));
    const consequence = {
      deprecate: "The concept remains searchable and retrieval adds a lifecycle caveat.",
      redirect: "Retrieval follows rewritten links to the replacement; the old identity remains an explicit redirect.",
      tombstone: "Retrieval sees only the retirement explanation, not the former claims.",
      delete: "The concept leaves the active bundle; rewritten links use the replacement when one was selected.",
    } satisfies Record<RetirementAction, string>;
    return {
      plan: {
        schemaVersion: 1,
        sourceId: request.sourceId,
        action: request.action,
        replacementId,
        affectedLinks: request.action === "redirect" || request.action === "delete" ? 2 : 1,
        affectedIndexes: request.action === "redirect" || request.action === "delete" ? 1 : 0,
        retrievalConsequence: consequence[request.action],
        warnings: [],
        changes,
      },
      staged: {
        sessionId: "concept-retirement-mock",
        granted: true,
        grantMode: "interactive",
        mode: "enhance",
        canRestore: mockConceptMoveCanRestore,
        files: changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          bytes: change.kind === "delete" ? 0 : 180,
        })),
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ConceptRetirementReview>("stage_concept_retirement", {
    bundleRoot,
    request,
  });
}

export async function conceptMoveDiff(
  bundleRoot: string,
  path: string,
): Promise<AgentStagedFileDiff> {
  if (!isTauri()) {
    await browserMockDelay(20);
    const diff = mockConceptMoveDiffs.get(path);
    if (!diff) throw new Error("This move file is no longer staged.");
    return structuredClone(diff);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedFileDiff>("concept_move_diff", { bundleRoot, path });
}

export async function selectConceptMoveHunk(
  bundleRoot: string,
  path: string,
  revision: string,
  hunkIndex: number,
  selected: boolean,
): Promise<AgentStagedFileDiff> {
  if (!isTauri()) {
    await browserMockDelay(20);
    const diff = mockConceptMoveDiffs.get(path);
    if (diff?.revision !== revision) {
      throw new Error("The move diff changed. Review it again.");
    }
    const updated = {
      ...diff,
      hunks: diff.hunks.map((hunk) => hunk.index === hunkIndex
        ? { ...hunk, selected, reviewed: true }
        : hunk),
    };
    mockConceptMoveDiffs.set(path, updated);
    return structuredClone(updated);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedFileDiff>("select_concept_move_hunk", {
    bundleRoot,
    path,
    revision,
    hunkIndex,
    selected,
  });
}

export async function validateConceptMove(
  bundleRoot: string,
): Promise<AgentStagedValidationInfo> {
  if (!isTauri()) {
    await browserMockDelay(30);
    if ([...mockConceptMoveDiffs.values()].some((diff) =>
      diff.truncated || diff.hunks.some((hunk) => !hunk.reviewed || !hunk.selected)
    )) {
      throw new Error(
        "Review and keep every move hunk before validation. A concept move is one graph transaction.",
      );
    }
    return {
      sessionId: "concept-move-mock",
      revision: "mock-move-validation-1",
      errors: 0,
      warnings: 0,
      issues: [],
      truncated: false,
      preview: { nodes: [], edges: [], totalNodes: 3, totalEdges: 2, truncated: false },
      profile: {
        source: "draft",
        declared: 0,
        active: 0,
        unavailable: 0,
        diagnostics: [],
        truncated: false,
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedValidationInfo>("validate_concept_move", { bundleRoot });
}

export async function applyConceptMove(
  bundleRoot: string,
  revision: string,
): Promise<AgentStagedApplyInfo> {
  if (!isTauri()) {
    await browserMockDelay(30);
    mockConceptMoveDiffs.clear();
    mockConceptMoveCanRestore = true;
    return {
      sessionId: "concept-move-mock",
      revision,
      appliedFiles: 3,
      changes: {
        sessionId: "concept-move-mock",
        granted: true,
        grantMode: "interactive",
        mode: "enhance",
        canRestore: true,
        files: [],
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedApplyInfo>("apply_concept_move", { bundleRoot, revision });
}

export async function discardConceptMove(bundleRoot: string): Promise<AgentStagedChangesInfo> {
  if (!isTauri()) {
    await browserMockDelay(20);
    mockConceptMoveDiffs.clear();
    return {
      sessionId: "concept-move-mock",
      granted: true,
      grantMode: "interactive",
      mode: "enhance",
      canRestore: mockConceptMoveCanRestore,
      files: [],
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentStagedChangesInfo>("discard_concept_move", { bundleRoot });
}

export async function restoreConceptMove(
  bundleRoot: string,
): Promise<AgentCheckpointRestoreInfo> {
  if (!isTauri()) {
    await browserMockDelay(30);
    mockConceptMoveCanRestore = false;
    return {
      sessionId: "concept-move-mock",
      restoredFiles: 3,
      changes: {
        sessionId: "concept-move-mock",
        granted: true,
        grantMode: "interactive",
        mode: "enhance",
        canRestore: false,
        files: [],
      },
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentCheckpointRestoreInfo>("restore_concept_move", { bundleRoot });
}

function mockCompatibilityChanges(canRestore: boolean): AgentStagedChangesInfo {
  return {
    sessionId: "compatibility-clinic-mock",
    granted: true,
    grantMode: "interactive",
    mode: "enhance",
    canRestore,
    files: mockCompatibilityDiff
      ? [{ path: mockCompatibilityDiff.path, bytes: 128, kind: "modify" }]
      : [],
  };
}

export async function pickGitRepositoryFolder(bundleRoot: string): Promise<string | null> {
  if (!isTauri()) return MOCK_FOLDER;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("pick_git_repository_folder", { bundleRoot });
}

export async function gitRepositorySnapshot(
  bundleRoot: string,
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return structuredClone(MOCK_GIT_SNAPSHOT);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_repository_snapshot", { bundleRoot });
}

export async function gitRepositoryHistory(
  bundleRoot: string,
  skip: number,
  limit: number,
): Promise<GitHistoryPage> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return {
      commits: MOCK_GIT_HISTORY.commits.slice(skip, skip + limit),
      hasMore: skip + limit < MOCK_GIT_HISTORY.commits.length,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitHistoryPage>("git_repository_history", {
    bundleRoot,
    skip,
    limit,
  });
}

export async function gitRepositoryDiff(
  bundleRoot: string,
  options: { path?: string; staged?: boolean; commit?: string },
): Promise<GitDiff> {
  if (!isTauri()) {
    await browserMockDelay(40);
    return {
      ...MOCK_GIT_DIFF,
      title: options.path ?? (options.commit ? `Commit ${options.commit.slice(0, 7)}` : MOCK_GIT_DIFF.title),
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitDiff>("git_repository_diff", {
    bundleRoot,
    path: options.path ?? null,
    staged: options.staged ?? false,
    commit: options.commit ?? null,
  });
}

function mockGitChanges(
  update: (change: GitRepositorySnapshot["changes"][number]) => GitRepositorySnapshot["changes"][number] | null,
): GitRepositorySnapshot {
  MOCK_GIT_SNAPSHOT = {
    ...MOCK_GIT_SNAPSHOT,
    changes: MOCK_GIT_SNAPSHOT.changes.flatMap((change) => {
      const next = update(change);
      return next ? [next] : [];
    }),
  };
  return structuredClone(MOCK_GIT_SNAPSHOT);
}

export async function gitStagePaths(
  bundleRoot: string,
  paths: string[],
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    return mockGitChanges((change) =>
      paths.includes(change.path) ? { ...change, staged: true, unstaged: false } : change
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_stage_paths", { bundleRoot, paths });
}

export async function gitUnstagePaths(
  bundleRoot: string,
  paths: string[],
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    return mockGitChanges((change) =>
      paths.includes(change.path) ? { ...change, staged: false, unstaged: true } : change
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_unstage_paths", { bundleRoot, paths });
}

export async function gitStageAll(bundleRoot: string): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    return mockGitChanges((change) => ({ ...change, staged: true, unstaged: false }));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_stage_all", { bundleRoot });
}

export async function gitUnstageAll(bundleRoot: string): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    return mockGitChanges((change) => ({ ...change, staged: false, unstaged: true }));
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_unstage_all", { bundleRoot });
}

export async function gitCommit(
  bundleRoot: string,
  message: string,
  includeTracked: boolean,
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    await browserMockDelay(40);
    const headSha = "a17c0de64b8cc0bbf352b82baeea804dde48a449";
    const snapshot = mockGitChanges((change) => {
      const included = change.staged || (includeTracked && change.kind !== "untracked");
      return included ? null : change;
    });
    MOCK_GIT_SNAPSHOT = { ...snapshot, headSha, ahead: snapshot.ahead + 1 };
    MOCK_GIT_HISTORY.commits.unshift({
      sha: headSha,
      shortSha: headSha.slice(0, 7),
      subject: message.split("\n", 1)[0],
      authorName: "Studio User",
      authorEmail: "user@example.invalid",
      timestamp: Math.floor(Date.now() / 1000),
    });
    return structuredClone(MOCK_GIT_SNAPSHOT);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_commit", {
    bundleRoot,
    message,
    includeTracked,
  });
}

export async function gitUndoCommit(
  bundleRoot: string,
  expectedHead: string,
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    MOCK_GIT_SNAPSHOT = {
      ...MOCK_GIT_SNAPSHOT,
      headSha: "972bdb14a0b8468df0106f639691a24e0ba9ee31",
      ahead: Math.max(0, MOCK_GIT_SNAPSHOT.ahead - 1),
      changes: [
        ...MOCK_GIT_SNAPSHOT.changes,
        { path: "docs/log.md", kind: "modified", staged: true, unstaged: false },
      ],
    };
    return structuredClone(MOCK_GIT_SNAPSHOT);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_undo_commit", { bundleRoot, expectedHead });
}

export async function gitRemoteOperation(
  bundleRoot: string,
  operation: GitRemoteOperation,
): Promise<GitRepositorySnapshot> {
  if (!isTauri()) {
    await browserMockDelay(80);
    return structuredClone(MOCK_GIT_SNAPSHOT);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GitRepositorySnapshot>("git_remote_operation", { bundleRoot, operation });
}

export async function exportRetrievalDiagnostics(
  suggestedName: string,
  payload: string,
): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("export_retrieval_diagnostics", { suggestedName, payload });
  }
  await browserMockDelay(80);
  return suggestedName;
}

export async function exportCompatibilityDiagnostic(
  suggestedName: string,
  payload: string,
): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string | null>("export_compatibility_diagnostic", { suggestedName, payload });
  }
  await browserMockDelay(80);
  return suggestedName;
}

export async function retrieveOkfContext(
  bundleRoot: string,
  request: RetrievalRequest,
): Promise<RetrievalResult> {
  // The engine judges `stale_after` against a date it is given rather than a
  // clock it reads, so that a receipt still means what it said when replayed.
  // Defaulted here, at the one door every caller goes through, because the
  // failure mode of forgetting it is silent: staleness simply stops being
  // noticed. A caller replaying a historical receipt can still pass its own.
  const dated = request.today ? request : { ...request, today: today() };
  if (!isTauri()) return mockRetrieval(MOCK_BUNDLE, dated);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<RetrievalResult>("retrieve_okf_context", { bundleRoot, request: dated });
}

export async function diffOkfRetrievalReceipts(
  left: RetrievalResult["receipt"],
  right: RetrievalResult["receipt"],
): Promise<ReceiptDiff> {
  if (!isTauri()) return mockReceiptDiff(left, right);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ReceiptDiff>("diff_okf_retrieval_receipts", { left, right });
}

const MOCK_LIBRARY_IDS = {
  active: "00000000-0000-4000-8000-000000000001",
  primer: "00000000-0000-4000-8000-000000000002",
  handbook: "00000000-0000-4000-8000-000000000003",
} as const;

const MOCK_LIBRARY_FINGERPRINTS: Record<string, string> = {
  [MOCK_LIBRARY_IDS.active]: "okf-health-revision-0000000000000001",
  [MOCK_LIBRARY_IDS.primer]: "okf-health-revision-0000000000000002",
  [MOCK_LIBRARY_IDS.handbook]: "okf-health-revision-0000000000000003",
};

function mockBundleLibrary(): BundleLibraryEntry[] {
  const activeTypes = [...new Set(MOCK_BUNDLE.concepts.map((concept) => concept.type))].sort();
  const activeTags = [...new Set(MOCK_BUNDLE.concepts.flatMap((concept) => concept.tags))].sort();
  return [
    {
      bundleId: MOCK_LIBRARY_IDS.active,
      title: MOCK_BUNDLE.name,
      kind: "localFolder",
      conceptCount: MOCK_BUNDLE.concepts.length,
      types: activeTypes,
      tags: activeTags,
      revisionFingerprint: MOCK_LIBRARY_FINGERPRINTS[MOCK_LIBRARY_IDS.active],
      grantState: "available",
      lastSeenEpochMs: 1_750_000_000_003,
      active: true,
    },
    {
      bundleId: MOCK_LIBRARY_IDS.primer,
      title: "Primer design system",
      kind: "localFolder",
      conceptCount: 60,
      types: ["Component", "Guideline", "Pattern", "Token"],
      tags: ["accessibility", "design-system"],
      revisionFingerprint: MOCK_LIBRARY_FINGERPRINTS[MOCK_LIBRARY_IDS.primer],
      grantState: "available",
      lastSeenEpochMs: 1_750_000_000_002,
      active: false,
    },
    {
      bundleId: MOCK_LIBRARY_IDS.handbook,
      title: "Team Handbook",
      kind: "localFolder",
      conceptCount: 202,
      types: ["Guide", "Policy", "Runbook", "Template"],
      tags: ["operations", "people"],
      revisionFingerprint: MOCK_LIBRARY_FINGERPRINTS[MOCK_LIBRARY_IDS.handbook],
      grantState: "available",
      lastSeenEpochMs: 1_750_000_000_001,
      active: false,
    },
  ];
}

export async function bundleLibrary(activeRoot?: string): Promise<BundleLibraryEntry[]> {
  if (!isTauri()) return mockBundleLibrary();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<BundleLibraryEntry[]>("bundle_library", { activeRoot });
}

export async function previewFederatedBundles(
  bundleIds: string[],
): Promise<FederatedBundleStatus[]> {
  if (!isTauri()) {
    const byId = new Map(mockBundleLibrary().map((entry) => [entry.bundleId, entry]));
    return bundleIds.map((bundleId) => {
      const entry = byId.get(bundleId);
      return entry
        ? {
            bundleId,
            title: entry.title,
            grantState: entry.grantState,
            revisionFingerprint: entry.revisionFingerprint,
            expectedFingerprint: null,
          }
        : {
            bundleId,
            title: "Unknown bundle",
            grantState: "revoked",
            revisionFingerprint: null,
            expectedFingerprint: null,
          };
    });
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FederatedBundleStatus[]>("preview_federated_bundles", { bundleIds });
}

export async function federatedInventory(
  selections: FederatedBundleSelection[],
  filters: { prefix?: string; conceptType?: string; tag?: string; limit?: number } = {},
): Promise<FederatedConceptPage> {
  if (!isTauri()) return mockFederatedConcepts(selections, "", filters.limit ?? 50);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FederatedConceptPage>("federated_inventory", {
    selections,
    prefix: filters.prefix,
    conceptType: filters.conceptType,
    tag: filters.tag,
    limit: filters.limit ?? 50,
  });
}

export async function federatedSearch(
  selections: FederatedBundleSelection[],
  query: string,
  limit = 50,
): Promise<FederatedConceptPage> {
  if (!isTauri()) return mockFederatedConcepts(selections, query, limit);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FederatedConceptPage>("federated_search", { selections, query, limit });
}

export async function federatedSources(
  selections: FederatedBundleSelection[],
  query?: string,
  limit = 50,
): Promise<FederatedSourcePage> {
  if (!isTauri()) {
    const concepts = mockFederatedConcepts(selections, "", 100);
    const results = concepts.results
      .flatMap((concept) => {
        const sourceConcept = MOCK_BUNDLE.concepts.find((item) => item.id === concept.conceptId);
        return [sourceConcept?.resource, ...(sourceConcept?.externalLinks ?? [])]
          .filter((uri): uri is string => Boolean(uri))
          .filter((uri) => !query || uri.toLowerCase().includes(query.toLowerCase()))
          .map((uri) => ({
            bundleId: concept.bundleId,
            bundleTitle: concept.bundleTitle,
            conceptId: concept.conceptId,
            revisionFingerprint: concept.revisionFingerprint,
            grantState: concept.grantState,
            uri,
            kinds: [sourceConcept?.resource === uri ? "resource" : "citation"],
          }));
      })
      .slice(0, limit);
    return { bundles: concepts.bundles, results, truncated: results.length === limit };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FederatedSourcePage>("federated_sources", { selections, query, limit });
}

export async function federatedRelationshipCandidates(
  selections: FederatedBundleSelection[],
  limit = 50,
): Promise<FederatedRelationshipPage> {
  if (!isTauri()) {
    const matches = conceptsForId(mockFederatedConcepts(selections, "", 100), "overview");
    return {
      bundles: matches.page.bundles,
      results: matches.results.length >= 2
        ? [{
            kind: "possible-duplicate",
            basis: "matching-title",
            evidence: matches.results[0].title.toLowerCase(),
            requiresReview: true,
            left: matches.results[0],
            right: matches.results[1],
          }]
        : [],
      truncated: false,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FederatedRelationshipPage>("federated_relationship_candidates", {
    selections,
    limit,
  });
}

function mockFederatedConcepts(
  selections: FederatedBundleSelection[],
  query: string,
  limit: number,
): FederatedConceptPage {
  const library = new Map(mockBundleLibrary().map((entry) => [entry.bundleId, entry]));
  const bundles: FederatedBundleStatus[] = [];
  const resultsByBundle: FederatedConceptPage["results"][] = [];
  const needle = query.trim().toLowerCase();
  for (const selection of selections) {
    const entry = library.get(selection.bundleId);
    const fingerprint = entry?.revisionFingerprint;
    const changed = entry && fingerprint !== selection.revisionFingerprint;
    bundles.push({
      bundleId: selection.bundleId,
      title: entry?.title ?? "Unknown bundle",
      grantState: !entry ? "revoked" : changed ? "changed" : entry.grantState,
      revisionFingerprint: fingerprint ?? null,
      expectedFingerprint: selection.revisionFingerprint,
    });
    if (!entry || changed || entry.grantState !== "available" || !fingerprint) continue;
    const bundleResults: FederatedConceptPage["results"] = [];
    for (const concept of MOCK_BUNDLE.concepts) {
      const haystack = [concept.id, concept.title, concept.type, concept.description, concept.body]
        .join(" ")
        .toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      bundleResults.push({
        bundleId: entry.bundleId,
        bundleTitle: entry.title,
        conceptId: concept.id,
        revisionFingerprint: fingerprint,
        grantState: "available",
        title: concept.title,
        type: concept.type,
        description: concept.description,
        tags: concept.tags,
        snippet: needle ? concept.description : "",
      });
    }
    resultsByBundle.push(bundleResults);
  }
  const results: FederatedConceptPage["results"] = [];
  for (let index = 0; results.length <= limit; index += 1) {
    let found = false;
    for (const bundleResults of resultsByBundle) {
      const result = bundleResults.at(index);
      if (!result) continue;
      results.push(result);
      found = true;
      if (results.length > limit) break;
    }
    if (!found || results.length > limit) break;
  }
  return {
    bundles,
    results: results.slice(0, limit),
    truncated: results.length > limit,
  };
}

function conceptsForId(page: FederatedConceptPage, conceptId: string) {
  return {
    page,
    results: page.results.filter((result) => result.conceptId === conceptId),
  };
}

/**
 * Read one companion asset's text (an ODSF `*.example.html` preview or a
 * `styles/*.css` it links) for the design-system renderer. `rel` is a
 * bundle-relative path; the Rust core guards against escaping the bundle root
 * and only serves text assets. Resolves to `null` when the asset is absent or
 * not permitted, so the caller degrades gracefully. Off-Tauri it serves the
 * in-memory mock so previews render in the browser and tests.
 */
export async function readAsset(
  root: string,
  rel: string,
): Promise<string | null> {
  if (!isTauri()) {
    const key = rel.replace(/^\/+/, "");
    // The backend serves only `html`, `css` and `svg` here (see
    // crates/okf-core/src/asset.rs); the mock enforces the same allowlist so it
    // is never more permissive than the app it stands in for.
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    if (!["html", "css", "svg"].includes(ext)) return null;
    return MOCK_ASSETS[key] ?? null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("read_asset", { root, rel });
}

/**
 * Read the computation an Attested Computation concept declares in a file.
 *
 * Takes a **concept id, not a path** — deliberately. The backend reads the path
 * out of that concept's own `computation` field, so the declaration is the
 * authorization and this cannot be pointed at anything else. A computation is
 * `.sql`, `.py`, whatever the runtime takes, so the extension allowlist that
 * guards `readAsset` could not have expressed what is permitted.
 *
 * `null` for every miss: no declared computation, an inline one, a missing or
 * oversized file. Returned for display; Studio never executes it.
 */
export async function readDeclaredComputation(
  bundleRoot: string,
  conceptId: string,
): Promise<string | null> {
  if (!isTauri()) {
    const concept = MOCK_BUNDLE.concepts.find((item) => item.id === conceptId);
    const declared = concept?.computation?.computation;
    return declared ? MOCK_ASSETS[declared.replace(/^\/+/, "")] ?? null : null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("read_declared_computation", { bundleRoot, conceptId });
}

/** Resolve the sanctioned computation the same way the backend does, then
 *  attest against it. Both halves live in mockAttestation.ts; this only finds
 *  the concept and its stored text. */
function mockAttestation(
  conceptId: string,
  receipt: Record<string, string>,
  on: string,
): AttestationReport {
  const concept = MOCK_BUNDLE.concepts.find((item) => item.id === conceptId);
  if (!concept) {
    return {
      conceptId,
      conceptTitle: conceptId,
      runtime: null,
      source: null,
      contractError: { reason: "notAComputation" },
      attestation: null,
      verdict: "contract-unreadable",
    };
  }
  const path = concept.computation?.computation ?? null;
  const stored = path
    ? MOCK_ASSETS[path.replace(/^\/+/, "")] ?? null
    : inlineComputation(concept.body);
  return mockAttestationFor(concept, stored, path, receipt, on);
}

/**
 * Attest one run of an Attested Computation against the bundle's contract.
 *
 * Takes a concept id and a receipt — never a computation. What the run is
 * checked *against* is read from the bundle by the backend, which is the only
 * arrangement where the check means anything: a caller supplying both sides
 * could always make them agree.
 *
 * Studio does not execute anything. Fidelity always comes back `unavailable`
 * because only the executor's runtime can re-read a result by job id, and
 * `unavailable` is never `passed`.
 */
export async function attestComputationRun(
  bundleRoot: string,
  conceptId: string,
  receipt: Record<string, string>,
  on = today(),
): Promise<AttestationReport> {
  if (!isTauri()) return mockAttestation(conceptId, receipt, on);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AttestationReport>("attest_computation_run", {
    bundleRoot,
    conceptId,
    receipt,
    today: on,
  });
}

/**
 * Read a *local* bundle image as a `data:` URL so the reader renders it inline
 * with no network fetch (the offline stance). Resolves to `null` when the image
 * is absent, not an image type, or escapes the bundle root. Off-Tauri it encodes
 * the in-memory mock asset so images render in the browser and tests.
 */
export async function readAssetDataUrl(
  root: string,
  rel: string,
): Promise<string | null> {
  if (!isTauri()) {
    const key = rel.replace(/^\/+/, "");
    const text = MOCK_ASSETS[key];
    if (!text) return null;
    const mime = key.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
    return `data:${mime};base64,${btoa(text)}`;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("read_asset_data_url", { root, rel });
}

/** Open an external URL in the OS browser (never fetched in-app). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

// --- Settings & recent bundles, persisted via the store plugin ---

const STORE_FILE = "okf-viewer.json";
const RECENTS_KEY = "recentBundles";
const AGENT_THREADS_KEY = "agentThreads";
const MOCK_AGENT_THREADS_KEY = "okf-studio:agent-threads";
const WORKSPACE_MEMORY_KEY = "workspaceMemoryV1";
const WORKSPACE_MEMORY_QUARANTINE_KEY = "workspaceMemoryQuarantineV1";
const MOCK_WORKSPACE_MEMORY_KEY = "okf-studio:workspace-memory-v1";
export const WORKSPACE_MEMORY_CHANGED_EVENT = "okf:workspace-memory-changed";
const RECENTS_CAP = 12;

async function store() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load(STORE_FILE);
}

export async function loadSettings(): Promise<Settings> {
  if (!isTauri()) return DEFAULT_SETTINGS;
  const s = await (await store()).get<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!isTauri()) return;
  const st = await store();
  await st.set("settings", settings);
  await st.save();
}

// Off-Tauri, recents live in memory, seeded from the fixture so the switcher's
// recent rows (pins, hover actions) render in browser dev and tests too.
let mockRecents: RecentBundle[] | null = null;

async function readRecents(): Promise<RecentBundle[]> {
  if (!isTauri()) return (mockRecents ??= MOCK_RECENTS.map((r) => ({ ...r })));
  return (await (await store()).get<RecentBundle[]>(RECENTS_KEY)) ?? [];
}

async function writeRecents(next: RecentBundle[]): Promise<void> {
  if (!isTauri()) {
    mockRecents = next;
    return;
  }
  const st = await store();
  await st.set(RECENTS_KEY, next);
  await st.save();
}

async function readAgentThreads(): Promise<AgentThreadMetadata[]> {
  if (!isTauri()) {
    try {
      return parseAgentThreadMetadata(JSON.parse(localStorage.getItem(MOCK_AGENT_THREADS_KEY) ?? "[]"));
    } catch {
      return [];
    }
  }
  return parseAgentThreadMetadata(await (await store()).get<unknown>(AGENT_THREADS_KEY));
}

async function writeAgentThreads(next: readonly AgentThreadMetadata[]): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(MOCK_AGENT_THREADS_KEY, JSON.stringify(next));
    return;
  }
  const st = await store();
  await st.set(AGENT_THREADS_KEY, next);
  await st.save();
}

export async function loadAgentThreadMetadata(
  bundleRoot: string,
  profileId: string,
): Promise<AgentThreadMetadata[]> {
  const threads = await readAgentThreads();
  return threads.filter((thread) =>
    thread.bundleRoot === bundleRoot && thread.profileId === profileId
  );
}

export async function saveAgentThreadMetadata(
  input: Omit<
    AgentThreadMetadata,
    "updatedAt" | "archived" | "taskId" | "contextManifest" | "prompts"
  > & {
    archived?: boolean;
    taskId?: OkfTaskId | null;
    contextManifest?: AcceptedOkfContextManifest | null;
    prompts?: readonly AgentThreadPrompt[];
  },
): Promise<AgentThreadMetadata> {
  const threads = await readAgentThreads();
  // Callers that only mean to rename or archive a thread must not erase its
  // recorded prompts, so an absent `prompts` keeps whatever is already stored
  // rather than defaulting to none.
  const prompts = input.prompts ?? threads.find((thread) =>
    thread.bundleRoot === input.bundleRoot && thread.profileId === input.profileId &&
    thread.sessionId === input.sessionId
  )?.prompts ?? [];
  const metadata = createAgentThreadMetadata({ ...input, prompts });
  await writeAgentThreads(upsertAgentThreadMetadata(threads, metadata));
  return metadata;
}

/**
 * Record a prompt as the user typed it, against its position among the thread's
 * user messages.
 *
 * Restoring a thread rebuilds it from the agent's replay, and every user message
 * in that replay has been through the adapter's storage format — Studio's
 * preamble, capability resource URIs and attached-source blocks run together
 * with the question. This is the record that lets restore show what was asked.
 *
 * Best-effort on purpose: a thread that cannot be written still prompts fine,
 * it just restores less faithfully, so a storage failure must not fail the turn.
 */
export async function recordAgentThreadPrompt(
  bundleRoot: string,
  profileId: string,
  sessionId: string,
  index: number,
  text: string,
): Promise<void> {
  try {
    const threads = await readAgentThreads();
    const existing = threads.find((thread) =>
      thread.bundleRoot === bundleRoot && thread.profileId === profileId &&
      thread.sessionId === sessionId
    );
    if (!existing) return;
    await writeAgentThreads(upsertAgentThreadMetadata(threads, {
      ...existing,
      prompts: withThreadPrompt(existing.prompts, index, text),
    }));
  } catch {
    // Recording is a convenience for the next restore, never a reason to lose a turn.
  }
}

export async function removeAgentThreadMetadata(
  bundleRoot: string,
  profileId: string,
  sessionId?: string,
): Promise<void> {
  await writeAgentThreads(
    removeThreadMetadata(await readAgentThreads(), bundleRoot, profileId, sessionId),
  );
}

async function writeWorkspaceMemory(items: readonly WorkspaceMemoryItem[]): Promise<void> {
  const value = memoryEnvelope(items);
  if (!isTauri()) {
    localStorage.setItem(MOCK_WORKSPACE_MEMORY_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(WORKSPACE_MEMORY_CHANGED_EVENT));
    return;
  }
  const st = await store();
  await st.set(WORKSPACE_MEMORY_KEY, value);
  await st.save();
  window.dispatchEvent(new Event(WORKSPACE_MEMORY_CHANGED_EVENT));
}

export function onWorkspaceMemoryChange(listener: () => void): () => void {
  window.addEventListener(WORKSPACE_MEMORY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(WORKSPACE_MEMORY_CHANGED_EVENT, listener);
}

async function readWorkspaceMemory(): Promise<WorkspaceMemoryItem[]> {
  let raw: unknown;
  if (!isTauri()) {
    try {
      raw = JSON.parse(localStorage.getItem(MOCK_WORKSPACE_MEMORY_KEY) ?? "null");
    } catch {
      raw = { schemaVersion: 0 };
    }
  } else {
    raw = await (await store()).get<unknown>(WORKSPACE_MEMORY_KEY);
  }
  const parsed = parseWorkspaceMemory(raw);
  if (parsed.rejectedCount > 0) {
    const quarantine = {
      schemaVersion: 1,
      detectedAt: Date.now(),
      rejectedCount: parsed.rejectedCount,
    };
    if (!isTauri()) {
      localStorage.setItem(WORKSPACE_MEMORY_QUARANTINE_KEY, JSON.stringify(quarantine));
      localStorage.setItem(MOCK_WORKSPACE_MEMORY_KEY, JSON.stringify(memoryEnvelope(parsed.items)));
    } else {
      const st = await store();
      await st.set(WORKSPACE_MEMORY_QUARANTINE_KEY, quarantine);
      await st.set(WORKSPACE_MEMORY_KEY, memoryEnvelope(parsed.items));
      await st.save();
    }
  }
  return parsed.items;
}

export async function loadWorkspaceMemory(bundleRoot: string): Promise<WorkspaceMemoryItem[]> {
  return (await readWorkspaceMemory()).filter((item) => item.bundleRoot === bundleRoot);
}

export async function saveWorkspaceOmissionPreference(input: {
  bundleRoot: string;
  taskId: OkfTaskId;
  conceptId: string;
  conceptTitle: string;
  validationFingerprint: string;
  origin?: "user-action" | "agent-suggestion-accepted";
}): Promise<WorkspaceMemoryItem> {
  const item = createOmissionPreference(input);
  await writeWorkspaceMemory(upsertWorkspaceMemory(await readWorkspaceMemory(), item));
  return item;
}

export async function recordWorkspaceTaskObservation(input: {
  bundleRoot: string;
  taskId: OkfTaskId;
  validationFingerprint: string;
}): Promise<void> {
  const item = createTaskRecord(input);
  await writeWorkspaceMemory(upsertWorkspaceMemory(await readWorkspaceMemory(), item));
}

export async function deleteWorkspaceMemoryItem(id: string): Promise<void> {
  const current = await readWorkspaceMemory();
  await writeWorkspaceMemory(current.filter((item) => item.id !== id));
}

export async function recentBundles(): Promise<RecentBundle[]> {
  return readRecents();
}

/** Keep every pinned entry; cap the unpinned tail of a newest-first list. */
function capRecents(list: RecentBundle[]): RecentBundle[] {
  let unpinned = 0;
  return list.filter((r) => (r.pinned ? true : ++unpinned <= RECENTS_CAP));
}

/** Record a freshly-opened bundle at the top of recents (dedup by root). */
export async function pushRecentBundle(
  entry: Omit<RecentBundle, "ts" | "pinned">,
): Promise<RecentBundle[]> {
  const prev = await readRecents();
  const pinned = prev.find((r) => r.root === entry.root)?.pinned ?? false;
  const next = capRecents([
    { ...entry, ts: Date.now(), pinned },
    ...prev.filter((r) => r.root !== entry.root),
  ]);
  await writeRecents(next);
  return next;
}

export async function pinBundle(root: string): Promise<RecentBundle[]> {
  const prev = await readRecents();
  const next = prev.map((r) =>
    r.root === root ? { ...r, pinned: !r.pinned } : r,
  );
  await writeRecents(next);
  return next;
}

export async function forgetBundle(root: string): Promise<RecentBundle[]> {
  const prev = await readRecents();
  const next = prev.filter((r) => r.root !== root);
  await writeRecents(next);
  return next;
}

// --- Live reload: watch the open folder ---

export interface BundleChanged {
  root: string;
  conceptIds: string[];
}

export interface GitStateChanged {
  bundleRoot: string;
}

/** Watch the active authorized repository and emit coalesced invalidations. */
export async function startGitWatch(
  bundleRoot: string,
  onChanged: (event: GitStateChanged) => void,
): Promise<() => void> {
  if (!isTauri()) {
    return () => {
      /* browser fixtures have no repository process to watch */
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<GitStateChanged>("git-state-changed", (event) =>
    onChanged(event.payload),
  );
  try {
    await invoke("git_start_watch", { bundleRoot });
  } catch (error) {
    unlisten();
    throw error;
  }
  return () => {
    unlisten();
    void invoke("git_stop_watch").catch(() => {
      /* best-effort cleanup */
    });
  };
}

/** Begin watching a folder. Returns a disposer that stops the watch. */
export async function startWatch(
  folder: string,
  onChanged: (e: BundleChanged) => void,
): Promise<() => void> {
  if (!isTauri())
    return () => {
      /* nothing to watch off-Tauri */
    };
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<BundleChanged>("bundle-changed", (ev) =>
    onChanged(ev.payload),
  );
  await invoke("start_watch", { folder });
  return () => {
    unlisten();
    void invoke("stop_watch").catch(() => {
      /* best-effort cleanup */
    });
  };
}
