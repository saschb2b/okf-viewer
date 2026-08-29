// Central app state: one source of truth for the active concept, the loaded
// bundle, filters, panels, and settings. Components read via useApp() and call
// actions; no pane holds competing selection state. See
// docs/architecture/frontend-architecture.md.

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Bundle,
  BundleRoot,
  Concept,
  RecentBundle,
  RemoteSource,
  Settings,
} from "@/shared/types.ts";
import { DEFAULT_SETTINGS } from "@/shared/types.ts";
import { indexIdForDir, indexNodeForId } from "@/shared/selectors.ts";
import { applyTheme } from "@/shared/theme.ts";
import * as ipc from "@/shared/ipc.ts";
import {
  isWindowMaximized,
  onWindowResized,
  openConceptWindow,
} from "@/shared/platform/window.ts";
import { checkForUpdateQuietly } from "@/shared/platform/updater.ts";
import type { UpdateStatus } from "@/shared/platform/updater.ts";
import { bundleContextFingerprint, type OkfTaskId } from "@/features/agent/taskContext.ts";
import type {
  OkfTaskLaunchRequest,
  OkfTaskOrigin,
} from "@/features/agent/taskLauncher.ts";

export type PanelName = "sidebar" | "reader" | "log" | "validation" | "lineage" | "agent" | "git";

/**
 * One open concept in the reader — a browser-style tab with its own
 * back/forward history. The active tab's fields are mirrored into the
 * top-level `activeConceptId`/`back`/`fwd` so every existing consumer of "the
 * selection" keeps working; only tab-aware UI reads `tabs` directly. See
 * docs/proposals/multi-view.md.
 */
export interface Tab {
  /** Session-monotonic identity (from State.nextTabId) — stable across
   *  reorders/closures, so React keys and close/activate actions can't hit
   *  the wrong tab. */
  id: number;
  conceptId: string | null;
  back: string[];
  fwd: string[];
}

/**
 * Boot target parsed from the window's query string. A popped-out tab opens a
 * new OS window of the same app pointed at `?folder=…&root=…&concept=…`; when
 * present, boot opens that bundle (instead of auto-reopening the most recent)
 * and lands on the concept in reader-only layout. See
 * docs/proposals/multi-view.md.
 */
interface BootTarget {
  folder: string;
  root: string;
  concept: string | null;
}

function parseBootTarget(): BootTarget | null {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  const folder = q.get("folder");
  const root = q.get("root");
  if (!folder || !root) return null;
  return { folder, root, concept: q.get("concept") };
}

const bootTarget = parseBootTarget();

/**
 * Result of a remote open. `opened` — a single bundle was fetched and opened;
 * `empty` — the URL was reachable but held no OKF bundle; `multiple` — the
 * fetched folder holds several bundles, so the caller (the dialog) offers a
 * picker rather than guessing which one to open. Fetch failures throw instead.
 */
export type RemoteOpenOutcome =
  | { status: "opened" }
  | { status: "empty" }
  | { status: "multiple"; folder: string; bundles: BundleRoot[] };

/** Which sidebar lens is showing: navigation (Index/Bundles) or filtering. */
export type Lens = "navigate" | "filter";

/**
 * Workspace layout mode (manual control always wins). "split" shows the graph
 * and reader side by side (default, reader weighted co-equal); "reader" hides
 * the graph for a focused read; "graph" hides the reader to explore. The
 * sidebar collapses independently via panels.sidebar. See
 * docs/proposals/reader-first-layout.md.
 */
export type LayoutMode = "split" | "reader" | "graph";

/**
 * Persisted pane widths in px. `null` means "use the default" — for the reader
 * the default is a co-equal fractional weight (set in CSS), so a fresh layout
 * favors content without pinning a pixel value. A drag writes a px value; a
 * double-click on a divider resets it back to null.
 */
export interface PaneSizes {
  sidebar: number | null;
  reader: number | null;
}

export interface AgentPanelLayout {
  open: boolean;
  width: number | null;
}

/**
 * Clamps (px) for draggable dividers; see reader-first-layout.md. Each minimum
 * keeps the pane itself usable. Maximums follow the window instead of a fixed
 * cap — like Zed's docks — leaving only a floor for the remaining surfaces.
 * The graph soaks up the flexible 1fr track and keeps its own 280px floor in
 * the grid template.
 */
function clampWindowWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

export function paneClamp(pane: "sidebar" | "reader"): { min: number; max: number } {
  const width = clampWindowWidth();
  return pane === "sidebar"
    ? { min: 200, max: Math.max(360, Math.round(width * 0.4)) }
    : { min: 320, max: Math.max(720, width - 560) };
}

/** The width the content area beside the agent panel needs so every visible
 * pane keeps its compressed floor (the activity bar is accounted separately).
 * Below this the open panel takes the surface over entirely (see App.tsx). */
export function workspaceFloor(s: {
  bundle: unknown;
  overview: boolean;
  layout: LayoutMode;
  panels: { sidebar: boolean; reader: boolean };
}): number {
  if (!s.bundle) return 384;
  const sidebar = s.panels.sidebar ? 168 : 0;
  if (s.overview) return sidebar + 360;
  const reader = (s.layout === "split" && s.panels.reader) || s.layout === "reader";
  const graph = s.layout === "split" || s.layout === "graph";
  return sidebar + (graph ? 288 : 0) + (reader ? (graph ? 228 : 320) : 0);
}

/** With layout state, the maximum stops exactly where the takeover would
 * begin, so a drag can widen the panel up to — but never past — the point
 * where the remaining workspace stays usable. Without state (persisted-width
 * loading), a conservative window-relative cap applies. */
export function agentPanelClamp(
  s?: Parameters<typeof workspaceFloor>[0],
): { min: number; max: number } {
  const width = clampWindowWidth();
  const max = s
    ? width - 48 - workspaceFloor(s)
    : Math.max(560, width - 448);
  return { min: 320, max: Math.max(320, max) };
}

const LAYOUT_KEY = "okf-viewer:layout";
const AGENT_PANEL_KEY = "okf-studio:agent-panel";

function loadAgentPanelLayout(): AgentPanelLayout {
  const fallback: AgentPanelLayout = { open: false, width: null };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(AGENT_PANEL_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<AgentPanelLayout>;
    const clamp = agentPanelClamp();
    return {
      open: stored.open === true,
      width:
        typeof stored.width === "number"
          ? Math.round(Math.min(clamp.max, Math.max(clamp.min, stored.width)))
          : null,
    };
  } catch {
    return fallback;
  }
}

function saveAgentPanelLayout(layout: AgentPanelLayout): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AGENT_PANEL_KEY, JSON.stringify(layout));
  } catch {
    // Persistence is best-effort; ignore quota/serialization errors.
  }
}

// The newest release version the user has already seen in Settings → Updates.
// Persisting it is what keeps the update badge one-shot per release: it shows
// until the user visits the Updates section once, then stays away for that
// version across launches and only re-arms for a newer release.
const UPDATE_SEEN_KEY = "okf-viewer:update-seen";

function loadUpdateSeenVersion(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(UPDATE_SEEN_KEY);
  } catch {
    return null;
  }
}

function saveUpdateSeenVersion(version: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(UPDATE_SEEN_KEY, version);
  } catch {
    // Persistence is best-effort; ignore quota/serialization errors.
  }
}

/** Whether the update badge should show: a release is available and the user
 *  has not yet acknowledged that version by visiting Settings → Updates. */
export function hasUnseenUpdate(s: Pick<State, "updateStatus" | "updateSeenVersion">): boolean {
  return s.updateStatus.kind === "available" && s.updateStatus.version !== s.updateSeenVersion;
}

/**
 * Which visualization the graph pane renders. "graph" is the force-directed
 * network (the default); the rest are space-filling hierarchy views built from
 * concept id paths and bundle indexes (src/viz/hierarchy.ts). Persisted with
 * the layout so a chosen view survives a relaunch. See
 * docs/features/viz-views.md.
 */
export type VizView = "graph" | "treemap" | "sunburst" | "pack";
export const VIZ_VIEWS: readonly VizView[] = [
  "graph",
  "treemap",
  "sunburst",
  "pack",
];

interface PersistedLayout {
  mode: LayoutMode;
  sizes: PaneSizes;
  viz: VizView;
}

function loadLayout(): PersistedLayout {
  const fallback: PersistedLayout = {
    mode: "split",
    sizes: { sidebar: null, reader: null },
    viz: "graph",
  };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<PersistedLayout>;
    const mode: LayoutMode =
      p.mode === "reader" || p.mode === "graph" ? p.mode : "split";
    const sizes: PaneSizes = {
      sidebar: typeof p.sizes?.sidebar === "number" ? p.sizes.sidebar : null,
      reader: typeof p.sizes?.reader === "number" ? p.sizes.reader : null,
    };
    // An old blob (no viz) or an unknown value falls back to the graph.
    const viz: VizView =
      p.viz !== undefined && VIZ_VIEWS.includes(p.viz) ? p.viz : "graph";
    return { mode, sizes, viz };
  } catch {
    return fallback;
  }
}

function saveLayout(mode: LayoutMode, sizes: PaneSizes, viz: VizView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ mode, sizes, viz }));
  } catch {
    // Persistence is best-effort; ignore quota/serialization errors.
  }
}

/**
 * Graph rendering mode. "focus" renders the ego neighborhood of the selected
 * concept; "overview" renders the whole (filtered) graph. See
 * docs/proposals/graph-from-picture-to-tool.md.
 */
export type GraphMode = "focus" | "overview";

/** How aggressively the graph prunes edges to a readable backbone (see
 *  src/graph/backbone.ts). "all" draws every cross-link (the raw, dense graph). */
export type LinkDensity = "sparse" | "balanced" | "all";
export interface State {
  folder: string | null;
  bundles: BundleRoot[];
  recents: RecentBundle[];
  switcherOpen: boolean;
  /** The bundle Overview/health landing view takes over the content area. */
  overview: boolean;
  remoteOpen: boolean;
  /** One-shot URL to prefill (and auto-fetch) the next time the remote dialog
   *  opens — the first-run example cards hand their URL off this way. */
  remoteSeed: string | null;
  /** The static "create new bundle" dialog (no agent involved). */
  createOpen: boolean;
  /** The reviewed shareable-bundle workflow for the active bundle. */
  projectionOpen: boolean;
  /** Bundle-level format, metadata, ignore rules, and advisory profiles. */
  bundleDetailsOpen: boolean;
  /** External sources, relationship exchange, and interoperability diagnostics. */
  connectionsOpen: boolean;
  /** How a bundle-sized job would divide into delegated runs. Read-only. */
  delegationPlanOpen: boolean;
  intakePlanOpen: boolean;
  maximized: boolean;
  activeRoot: string | null;
  bundle: Bundle | null;
  loading: boolean;
  error: string | null;
  /** Mirror of the active tab's concept — the single shared selection. */
  activeConceptId: string | null;
  /** Mirror of the active tab's history (per-tab, like a browser). */
  back: string[];
  fwd: string[];
  /** Open reader tabs (always ≥ 1). See docs/proposals/multi-view.md. */
  tabs: Tab[];
  activeTabId: number;
  /** Monotonic id source for new tabs (in state, so the reducer stays pure). */
  nextTabId: number;
  query: string;
  hiddenTypes: string[];
  activeTag: string | null;
  lens: Lens;
  /** Which visualization the graph pane renders (persisted with the layout). */
  vizView: VizView;
  graphMode: GraphMode;
  focusDepth: number;
  linkDensity: LinkDensity;
  layout: LayoutMode;
  paneSizes: PaneSizes;
  agentPanelWidth: number | null;
  panels: Record<PanelName, boolean>;
  palette: boolean;
  /** One-shot initial query for the next palette open (e.g. the sidebar's
   *  "Open full search" hand-off); null means keep the palette's own value. */
  paletteSeed: string | null;
  /** One native OKF task hand-off, consumed by the shared agent launcher. */
  okfTaskLauncher: OkfTaskLaunchRequest | null;
  settingsOpen: boolean;
  help: boolean;
  settings: Settings;
  /** Shared updater state: fed by the quiet launch check and by the explicit
   *  actions in Settings → Updates, read by the settings-icon badge. */
  updateStatus: UpdateStatus;
  /** Last release version acknowledged in Settings → Updates (persisted). */
  updateSeenVersion: string | null;
}

// Built per AppProvider mount (useReducer's lazy initializer) rather than at
// module load, so the persisted layout/viz is read when the window actually
// boots — and a re-mounted provider (tests, future multi-window) sees fresh
// storage.
function makeInitialState(): State {
  const persistedLayout = loadLayout();
  const persistedAgentPanel = loadAgentPanelLayout();
  return {
  folder: null,
  bundles: [],
  recents: [],
  switcherOpen: false,
  overview: false,
  remoteOpen: false,
  remoteSeed: null,
  createOpen: false,
  projectionOpen: false,
  bundleDetailsOpen: false,
  connectionsOpen: false,
  delegationPlanOpen: false,
  intakePlanOpen: false,
  maximized: false,
  activeRoot: null,
  bundle: null,
  loading: false,
  error: null,
  activeConceptId: null,
  back: [],
  fwd: [],
  tabs: [{ id: 1, conceptId: null, back: [], fwd: [] }],
  activeTabId: 1,
  nextTabId: 2,
  query: "",
  hiddenTypes: [],
  activeTag: null,
  lens: "navigate",
  vizView: persistedLayout.viz,
  graphMode: "focus",
  focusDepth: 1,
  linkDensity: "balanced",
  // A pop-out window boots as a document window: reader-only, sidebar tucked
  // away (both reversible from its own chrome). Not persisted — only a layout
  // *action* saves, so the main window's saved layout is untouched.
  layout: bootTarget ? "reader" : persistedLayout.mode,
  paneSizes: persistedLayout.sizes,
  agentPanelWidth: persistedAgentPanel.width,
  panels: {
    sidebar: !bootTarget,
    reader: true,
    log: false,
    validation: false,
    lineage: false,
    agent: persistedAgentPanel.open,
    git: false,
  },
  palette: false,
  paletteSeed: null,
  okfTaskLauncher: null,
  settingsOpen: false,
  help: false,
  settings: DEFAULT_SETTINGS,
  updateStatus: { kind: "idle" },
  updateSeenVersion: loadUpdateSeenVersion(),
  };
}

type Msg =
  | { t: "loading"; v: boolean }
  | { t: "error"; v: string | null }
  | { t: "openFolder"; folder: string; bundles: BundleRoot[] }
  | { t: "recents"; v: RecentBundle[] }
  | { t: "switcher"; v: boolean }
  | { t: "overview"; v: boolean }
  | { t: "showOnlyType"; v: string }
  | { t: "remoteOpen"; v: boolean; seed?: string }
  | { t: "createOpen"; v: boolean }
  | { t: "projectionOpen"; v: boolean }
  | { t: "bundleDetailsOpen"; v: boolean }
  | { t: "connectionsOpen"; v: boolean }
  | { t: "delegationPlanOpen"; v: boolean }
  | { t: "intakePlanOpen"; v: boolean }
  | { t: "maximized"; v: boolean }
  | { t: "setBundle"; root: string; bundle: Bundle }
  | { t: "select"; id: string | null }
  | { t: "back" }
  | { t: "fwd" }
  | { t: "openTab"; id: string | null; background?: boolean }
  | { t: "closeTab"; tabId: number }
  | { t: "activateTab"; tabId: number }
  | { t: "cycleTab"; dir: 1 | -1 }
  | { t: "moveTab"; tabId: number; to: number }
  | { t: "query"; v: string }
  | { t: "toggleType"; v: string }
  | { t: "showAllTypes" }
  | { t: "tag"; v: string | null }
  | { t: "lens"; v: Lens }
  | { t: "vizView"; v: VizView }
  | { t: "cycleViz" }
  | { t: "graphMode"; v: GraphMode }
  | { t: "focusDepth"; v: number }
  | { t: "linkDensity"; v: LinkDensity }
  | { t: "layout"; v: LayoutMode }
  | { t: "cycleLayout" }
  | { t: "paneSize"; pane: "sidebar" | "reader"; v: number | null }
  | { t: "agentPanelWidth"; v: number | null }
  | { t: "panel"; name: PanelName; v?: boolean }
  | { t: "palette"; v: boolean; seed?: string }
  | { t: "okfTaskLauncher"; v: OkfTaskLaunchRequest | null }
  | { t: "settingsOpen"; v: boolean }
  | { t: "help"; v: boolean }
  | { t: "settings"; v: Settings }
  | { t: "updateStatus"; v: UpdateStatus }
  | { t: "updateSeen"; v: string };

/**
 * Re-derive the selection mirrors (`activeConceptId`/`back`/`fwd`) from the
 * active tab. Every reducer branch that changes tabs or the active tab goes
 * through here, so the mirrors — which the rest of the app reads — can never
 * drift from the tab that owns them.
 */
function withTabs(s: State, tabs: Tab[], activeTabId: number): State {
  const t = tabs.find((x) => x.id === activeTabId) ?? tabs[0];
  return {
    ...s,
    tabs,
    activeTabId: t.id,
    activeConceptId: t.conceptId,
    back: t.back,
    fwd: t.fwd,
  };
}

function defaultConcept(bundle: Bundle): string | null {
  // Land on the bundle root's folder home (its index.md) — OKF's progressive-
  // disclosure entry point — so the authored orientation shows first. Falls back
  // to the first listed concept, then the first concept, for a bundle that has
  // no root index node at all.
  if (bundle.indexes.some((n) => n.dir === "" || n.dir === ".")) return indexIdForDir("");
  for (const idx of bundle.indexes) {
    for (const sec of idx.sections) {
      const e = sec.entries.find((x) => x.kind === "concept");
      if (e) return e.target;
    }
  }
  return bundle.concepts[0]?.id ?? null;
}

function reducer(s: State, m: Msg): State {
  switch (m.t) {
    case "loading":
      return { ...s, loading: m.v };
    case "error":
      return { ...s, error: m.v, loading: false };
    case "openFolder":
      return { ...s, folder: m.folder, bundles: m.bundles, error: null };
    case "recents":
      return { ...s, recents: m.v };
    case "switcher":
      return { ...s, switcherOpen: m.v };
    case "overview":
      return { ...s, overview: m.v };
    case "showOnlyType": {
      // Show only concepts of type `v` — hide every other type present. Leaves
      // the overview and reveals the Filter lens so the applied filter is visible.
      const all = [
        ...new Set((s.bundle?.concepts ?? []).map((c) => c.type).filter(Boolean)),
      ];
      return {
        ...s,
        hiddenTypes: all.filter((t) => t !== m.v),
        overview: false,
        lens: "filter",
      };
    }
    case "remoteOpen":
      return { ...s, remoteOpen: m.v, remoteSeed: m.v ? (m.seed ?? null) : null };
    case "createOpen":
      return { ...s, createOpen: m.v };
    case "projectionOpen":
      return { ...s, projectionOpen: m.v };
    case "bundleDetailsOpen":
      return { ...s, bundleDetailsOpen: m.v };
    case "connectionsOpen":
      return { ...s, connectionsOpen: m.v };
    case "delegationPlanOpen":
      return { ...s, delegationPlanOpen: m.v };
    case "intakePlanOpen":
      return { ...s, intakePlanOpen: m.v };
    case "maximized":
      return { ...s, maximized: m.v };
    case "setBundle": {
      const exists = (id: string | null) =>
        !!id &&
        (m.bundle.concepts.some((c) => c.id === id) ||
          indexNodeForId(m.bundle, id) !== null);
      if (m.root !== s.activeRoot) {
        // Switching bundles: a new browsing context — reset view state and the
        // tabs down to a single tab. The active concept survives when the new
        // root still has it (a remote refresh lands in a fresh cache folder but
        // holds the same bundle); otherwise land on the entry concept.
        const tab: Tab = {
          id: s.nextTabId,
          conceptId: exists(s.activeConceptId)
            ? s.activeConceptId
            : defaultConcept(m.bundle),
          back: [],
          fwd: [],
        };
        return withTabs(
          {
            ...s,
            activeRoot: m.root,
            bundle: m.bundle,
            loading: false,
            error: null,
            nextTabId: s.nextTabId + 1,
            query: "",
            hiddenTypes: [],
            activeTag: null,
          },
          [tab],
          tab.id,
        );
      }
      // Live reload of the same root: keep the tabs. The active tab falls back
      // to the bundle's entry concept if its concept vanished; a background tab
      // whose concept vanished empties out and says so when revisited.
      const tabs = s.tabs.map((t) => {
        if (exists(t.conceptId)) return t;
        return {
          ...t,
          conceptId: t.id === s.activeTabId ? defaultConcept(m.bundle) : null,
        };
      });
      return withTabs(
        { ...s, activeRoot: m.root, bundle: m.bundle, loading: false, error: null },
        tabs,
        s.activeTabId,
      );
    }
    case "select": {
      // Selecting a concept always leaves the Overview landing (you're diving in).
      if (m.id === s.activeConceptId) return s.overview ? { ...s, overview: false } : s;
      // Navigation happens in the active tab (a browser's current tab).
      const tabs = s.tabs.map((t) =>
        t.id === s.activeTabId
          ? {
              ...t,
              conceptId: m.id,
              back: t.conceptId ? [...t.back, t.conceptId] : t.back,
              fwd: [],
            }
          : t,
      );
      return {
        ...withTabs(s, tabs, s.activeTabId),
        palette: false,
        overview: false,
      };
    }
    case "back": {
      if (!s.back.length) return s;
      const tabs = s.tabs.map((t) =>
        t.id === s.activeTabId
          ? {
              ...t,
              back: t.back.slice(0, -1),
              fwd: t.conceptId ? [t.conceptId, ...t.fwd] : t.fwd,
              conceptId: t.back[t.back.length - 1],
            }
          : t,
      );
      return withTabs(s, tabs, s.activeTabId);
    }
    case "fwd": {
      if (!s.fwd.length) return s;
      const tabs = s.tabs.map((t) =>
        t.id === s.activeTabId
          ? {
              ...t,
              fwd: t.fwd.slice(1),
              back: t.conceptId ? [...t.back, t.conceptId] : t.back,
              conceptId: t.fwd[0],
            }
          : t,
      );
      return withTabs(s, tabs, s.activeTabId);
    }
    case "openTab": {
      // Insert after the active tab (the browser convention: children sit
      // beside their opener). Background keeps the current tab active.
      const tab: Tab = { id: s.nextTabId, conceptId: m.id, back: [], fwd: [] };
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const tabs = [...s.tabs.slice(0, idx + 1), tab, ...s.tabs.slice(idx + 1)];
      const grown = { ...s, nextTabId: s.nextTabId + 1 };
      if (m.background) return withTabs(grown, tabs, s.activeTabId);
      return {
        ...withTabs(grown, tabs, tab.id),
        palette: false,
        overview: false,
      };
    }
    case "closeTab": {
      // The last tab never closes — the reader pane always has a subject
      // (closing "the window" is the OS close button's job, not the strip's).
      if (s.tabs.length <= 1) return s;
      const idx = s.tabs.findIndex((t) => t.id === m.tabId);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== m.tabId);
      // Closing the active tab activates its right neighbor (else the new last).
      const active =
        m.tabId === s.activeTabId
          ? tabs[Math.min(idx, tabs.length - 1)].id
          : s.activeTabId;
      return withTabs(s, tabs, active);
    }
    case "activateTab": {
      if (!s.tabs.some((t) => t.id === m.tabId)) return s;
      if (m.tabId === s.activeTabId) return s;
      return { ...withTabs(s, s.tabs, m.tabId), overview: false };
    }
    case "cycleTab": {
      if (s.tabs.length < 2) return s;
      const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      const next = s.tabs[(idx + m.dir + s.tabs.length) % s.tabs.length];
      return { ...withTabs(s, s.tabs, next.id), overview: false };
    }
    case "moveTab": {
      // Reorder only — the active tab (and so the selection) is unchanged.
      const idx = s.tabs.findIndex((t) => t.id === m.tabId);
      if (idx < 0) return s;
      const to = Math.max(0, Math.min(s.tabs.length - 1, m.to));
      if (to === idx) return s;
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(idx, 1);
      tabs.splice(to, 0, tab);
      return withTabs(s, tabs, s.activeTabId);
    }
    case "query":
      return { ...s, query: m.v };
    case "toggleType":
      return {
        ...s,
        hiddenTypes: s.hiddenTypes.includes(m.v)
          ? s.hiddenTypes.filter((t) => t !== m.v)
          : [...s.hiddenTypes, m.v],
      };
    case "showAllTypes":
      return { ...s, hiddenTypes: [] };
    case "tag":
      return { ...s, activeTag: m.v };
    case "lens":
      return { ...s, lens: m.v };
    case "vizView": {
      if (m.v === s.vizView) return s;
      saveLayout(s.layout, s.paneSizes, m.v);
      return { ...s, vizView: m.v };
    }
    case "cycleViz": {
      const next =
        VIZ_VIEWS[(VIZ_VIEWS.indexOf(s.vizView) + 1) % VIZ_VIEWS.length];
      saveLayout(s.layout, s.paneSizes, next);
      return { ...s, vizView: next };
    }
    case "graphMode":
      return { ...s, graphMode: m.v };
    case "focusDepth":
      // Clamp to the supported 1/2/3 depth control.
      return { ...s, focusDepth: Math.min(3, Math.max(1, Math.round(m.v))) };
    case "linkDensity":
      return { ...s, linkDensity: m.v };
    case "layout": {
      if (m.v === s.layout) return s;
      saveLayout(m.v, s.paneSizes, s.vizView);
      return { ...s, layout: m.v };
    }
    case "cycleLayout": {
      const order: LayoutMode[] = ["split", "reader", "graph"];
      const next = order[(order.indexOf(s.layout) + 1) % order.length];
      saveLayout(next, s.paneSizes, s.vizView);
      return { ...s, layout: next };
    }
    case "paneSize": {
      const clamp = paneClamp(m.pane);
      const v =
        m.v === null
          ? null
          : Math.round(Math.min(clamp.max, Math.max(clamp.min, m.v)));
      const paneSizes = { ...s.paneSizes, [m.pane]: v };
      saveLayout(s.layout, paneSizes, s.vizView);
      return { ...s, paneSizes };
    }
    case "agentPanelWidth": {
      const clamp = agentPanelClamp(s);
      const width =
        m.v === null
          ? null
          : Math.round(Math.min(clamp.max, Math.max(clamp.min, m.v)));
      saveAgentPanelLayout({ open: s.panels.agent, width });
      return { ...s, agentPanelWidth: width };
    }
    case "panel": {
      const open = m.v ?? !s.panels[m.name];
      if (m.name === "agent") {
        saveAgentPanelLayout({ open, width: s.agentPanelWidth });
      } else if (m.name === "git" && open && s.panels.agent) {
        saveAgentPanelLayout({ open: false, width: s.agentPanelWidth });
      }
      return {
        ...s,
        panels: {
          ...s.panels,
          [m.name]: open,
          ...(open && m.name === "agent" ? { git: false } : {}),
          ...(open && m.name === "git" ? { agent: false } : {}),
        },
      };
    }
    case "palette":
      return { ...s, palette: m.v, paletteSeed: m.v ? (m.seed ?? null) : null };
    case "okfTaskLauncher":
      return { ...s, okfTaskLauncher: m.v };
    case "settingsOpen":
      return { ...s, settingsOpen: m.v };
    case "help":
      return { ...s, help: m.v };
    case "settings":
      return { ...s, settings: m.v };
    case "updateStatus":
      return { ...s, updateStatus: m.v };
    case "updateSeen":
      return { ...s, updateSeenVersion: m.v };
  }
}

export interface Actions {
  openFolder(): Promise<void>;
  openFolderPath(folder: string, remote?: RemoteSource): Promise<Bundle | null>;
  /** Fetch a remote bundle and report the outcome (see RemoteOpenOutcome);
   *  throws on fetch failure. A single bundle opens directly; several defer to
   *  the caller's picker via `openRemoteChoice`. */
  openRemote(source: RemoteSource): Promise<RemoteOpenOutcome>;
  /** Open one specific bundle from a already-fetched remote folder (the picker). */
  openRemoteChoice(
    root: string,
    folder: string,
    bundles: BundleRoot[],
    source: RemoteSource,
  ): Promise<void>;
  refreshRemote(entry: RecentBundle): Promise<void>;
  selectBundle(root: string, folder?: string, remote?: RemoteSource): Promise<Bundle | null>;
  openRecentBundle(entry: RecentBundle): Promise<void>;
  pinBundle(root: string): Promise<void>;
  forgetBundle(root: string): Promise<void>;
  setSwitcher(open: boolean): void;
  setOverview(open: boolean): void;
  showOnlyType(type: string): void;
  setRemoteOpen(open: boolean, seed?: string): void;
  setCreateOpen(open: boolean): void;
  setProjectionOpen(open: boolean): void;
  setBundleDetailsOpen(open: boolean): void;
  setConnectionsOpen(open: boolean): void;
  setDelegationPlanOpen(open: boolean): void;
  setIntakePlanOpen(open: boolean): void;
  /** Static new-bundle generation (see docs/features/create-bundle.md):
   *  Rust shows the parent-folder picker, writes the conformant starter, and
   *  the result opens like any picked folder. Resolves false when the user
   *  cancelled the picker. */
  createBundle(input: ipc.CreateBundleInput): Promise<boolean>;
  rescan(): Promise<void>;
  selectConcept(id: string | null): void;
  /** Open a concept in a new tab beside the active one. `background` (the
   *  Ctrl/Cmd+click default) keeps the current tab active, like a browser. */
  openInNewTab(id: string | null, opts?: { background?: boolean }): void;
  /** Close a tab (default: the active one). The last tab never closes. */
  closeTab(tabId?: number): void;
  activateTab(tabId: number): void;
  cycleTab(dir: 1 | -1): void;
  /** Reorder a tab to a new index (drag-to-reorder in the strip). */
  moveTab(tabId: number, to: number): void;
  /** Undock a tab (default: the active one) into its own OS window — the
   *  browser tear-off. The local tab closes once the window exists, unless it
   *  is the only one. */
  popOutTab(tabId?: number): Promise<void>;
  back(): void;
  forward(): void;
  setQuery(q: string): void;
  toggleType(t: string): void;
  showAllTypes(): void;
  setTag(tag: string | null): void;
  setLens(lens: Lens): void;
  setVizView(view: VizView): void;
  /** Advance to the next visualization (the bare `V` shortcut). */
  cycleViz(): void;
  setGraphMode(mode: GraphMode): void;
  setFocusDepth(depth: number): void;
  setLinkDensity(density: LinkDensity): void;
  setLayout(mode: LayoutMode): void;
  cycleLayout(): void;
  setPaneSize(pane: "sidebar" | "reader", value: number | null): void;
  setAgentPanelWidth(value: number | null): void;
  togglePanel(name: PanelName, value?: boolean): void;
  setPalette(open: boolean, seed?: string): void;
  openOkfTaskLauncher(
    origin: OkfTaskOrigin,
    options?: { preferredTaskId?: OkfTaskId; promptDraft?: string; returnFocusId?: string },
  ): void;
  closeOkfTaskLauncher(options?: { restoreFocus?: boolean }): void;
  setSettingsOpen(open: boolean): void;
  setHelp(open: boolean): void;
  updateSettings(patch: Partial<Settings>): void;
  /** Report an updater result (from the explicit check/install flow). */
  setUpdateStatus(status: UpdateStatus): void;
  /** Acknowledge an available release: hides the badge for that version. */
  markUpdateSeen(version: string): void;
  openExternal(url: string): void;
}

// Split the store into two contexts (the state/dispatch pattern): the data and
// the (stable) action set. Keeping them apart means the ActionsCtx value never
// changes, so an action-only consumer (useAppActions) never re-renders when the
// data changes; and each context throws its own clear "outside provider" error.
const StateCtx = createContext<State | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState);
  // Latest state for async actions to read. Updated in an effect (not during
  // render) so it never mutates a ref while rendering; actions run from event
  // handlers/effects after commit, so they always see the current value.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Build the action set once (useState's lazy initializer): every action closes
  // only over the stable `dispatch` and the always-fresh `stateRef`, so a single
  // object stays correct forever — and a stable reference keeps the ActionsCtx
  // value from ever changing, so action-only consumers don't re-render on data.
  const [actions] = useState<Actions>(() => {
    const a: Actions = {
    async openFolder() {
      const folder = await ipc.pickFolder();
      if (!folder) return;
      await a.openFolderPath(folder);
    },
    async openFolderPath(folder, remote) {
      dispatch({ t: "loading", v: true });
      try {
        const bundles = await ipc.scanBundles(
          folder,
          stateRef.current.settings.scanMaxDepth,
        );
        dispatch({ t: "openFolder", folder, bundles });
        if (bundles.length >= 1)
          return await a.selectBundle(bundles[0].root, folder, remote);
        dispatch({ t: "loading", v: false });
      } catch (e) {
        dispatch({ t: "error", v: String(e) });
      }
      return null;
    },
    async openRemote(source) {
      // The detector runs in two phases, both surfaced by the dialog, and
      // NOTHING is switched until we know there's a bundle to open:
      //   1. Fetch — a network/HTTP failure throws (the dialog shows an error).
      //   2. Scan the fetched cache. Zero bundles → return "empty": the URL was
      //      reachable but holds no conformant OKF bundle (e.g. a repo of plain
      //      files, or the wrong subpath). The dialog shows a distinct, calm
      //      "not a bundle" explanation rather than silently leaving the
      //      previous bundle in place.
      const { folder } = await ipc.fetchRemoteBundle(source);
      const bundles = await ipc.scanBundles(
        folder,
        stateRef.current.settings.scanMaxDepth,
      );
      if (bundles.length === 0) return { status: "empty" };
      // Several bundles at that URL → let the user pick which one, rather than
      // silently opening the first. The dialog renders the choices.
      if (bundles.length > 1) return { status: "multiple", folder, bundles };
      dispatch({ t: "remoteOpen", v: false });
      dispatch({ t: "openFolder", folder, bundles });
      // Tagged with its origin so the recent entry remembers where it came from.
      await a.selectBundle(bundles[0].root, folder, source);
      return { status: "opened" };
    },
    async openRemoteChoice(root, folder, bundles, source) {
      dispatch({ t: "remoteOpen", v: false });
      dispatch({ t: "openFolder", folder, bundles });
      await a.selectBundle(root, folder, source);
    },
    async refreshRemote(entry) {
      if (!entry.remote) return;
      dispatch({ t: "loading", v: true });
      try {
        const { folder } = await ipc.fetchRemoteBundle(entry.remote);
        await a.openFolderPath(folder, entry.remote);
      } catch (e) {
        dispatch({ t: "error", v: String(e) });
      }
    },
    async selectBundle(root, folder, remote) {
      dispatch({ t: "loading", v: true });
      try {
        const bundle = await ipc.readBundle(root);
        dispatch({ t: "setBundle", root, bundle });
        // Record this bundle in recents, keyed by root, with the folder that
        // granted its read scope so it can be re-granted on reopen. `remote`
        // (when present) remembers the URL it was fetched from.
        const f = folder ?? stateRef.current.folder;
        if (f) {
          const types = [
            ...new Set(bundle.concepts.map((c) => c.type).filter(Boolean)),
          ].sort();
          const recents = await ipc.pushRecentBundle({
            root,
            folder: f,
            name: bundle.name,
            conceptCount: bundle.concepts.length,
            types,
            remote,
          });
          dispatch({ t: "recents", v: recents });
        }
        return bundle;
      } catch (e) {
        dispatch({ t: "error", v: String(e) });
        return null;
      }
    },
    async openRecentBundle(entry) {
      dispatch({ t: "loading", v: true });
      try {
        // Re-grant the folder scope, then open the specific bundle (falling
        // back to the first if it has moved/disappeared inside the folder).
        let folder = entry.folder;
        let bundles = await ipc.scanBundles(
          folder,
          stateRef.current.settings.scanMaxDepth,
        );
        // A remote bundle's folder is a local cache that may have been evicted;
        // if nothing's there, re-fetch from source (still explicit — the user
        // clicked this recent) before giving up.
        if (bundles.length === 0 && entry.remote) {
          folder = (await ipc.fetchRemoteBundle(entry.remote)).folder;
          bundles = await ipc.scanBundles(
            folder,
            stateRef.current.settings.scanMaxDepth,
          );
        }
        dispatch({ t: "openFolder", folder, bundles });
        const root = bundles.some((b) => b.root === entry.root)
          ? entry.root
          : bundles[0]?.root;
        if (root) await a.selectBundle(root, folder, entry.remote);
        else dispatch({ t: "loading", v: false });
      } catch (e) {
        dispatch({ t: "error", v: String(e) });
      }
    },
    async pinBundle(root) {
      dispatch({ t: "recents", v: await ipc.pinBundle(root) });
    },
    async forgetBundle(root) {
      const forgotten = stateRef.current.recents.find((entry) => entry.root === root);
      // Forgetting the last inactive recent from a folder also removes its
      // Rust-owned read grant. Keep the active folder live until it is closed.
      if (
        forgotten &&
        forgotten.folder !== stateRef.current.folder &&
        !stateRef.current.recents.some(
          (entry) => entry.root !== root && entry.folder === forgotten.folder,
        )
      ) {
        await ipc.revokeBundleGrant(forgotten.folder);
      }
      dispatch({ t: "recents", v: await ipc.forgetBundle(root) });
    },
    setSwitcher(open) {
      dispatch({ t: "switcher", v: open });
    },
    setOverview(open) {
      dispatch({ t: "overview", v: open });
    },
    showOnlyType(type) {
      dispatch({ t: "showOnlyType", v: type });
    },
    setRemoteOpen(open, seed) {
      dispatch({ t: "remoteOpen", v: open, seed });
    },
    setCreateOpen(open) {
      dispatch({ t: "createOpen", v: open });
    },
    setProjectionOpen(open) {
      dispatch({ t: "projectionOpen", v: open });
    },
    setBundleDetailsOpen(open) {
      dispatch({ t: "bundleDetailsOpen", v: open });
    },
    setIntakePlanOpen(open) {
      dispatch({ t: "intakePlanOpen", v: open });
    },
    setDelegationPlanOpen(open) {
      dispatch({ t: "delegationPlanOpen", v: open });
    },
    setConnectionsOpen(open) {
      dispatch({ t: "connectionsOpen", v: open });
    },
    async createBundle(input) {
      const folder = await ipc.createBundle(input);
      if (!folder) return false;
      dispatch({ t: "createOpen", v: false });
      await a.openFolderPath(folder);
      return true;
    },
    async rescan() {
      const { folder, activeRoot } = stateRef.current;
      if (!folder) return;
      const bundles = await ipc.scanBundles(
          folder,
          stateRef.current.settings.scanMaxDepth,
        );
      dispatch({ t: "openFolder", folder, bundles });
      const root = activeRoot ?? bundles[0]?.root;
      if (root) await a.selectBundle(root);
    },
    selectConcept(id) {
      dispatch({ t: "select", id });
    },
    openInNewTab(id, opts) {
      dispatch({ t: "openTab", id, background: opts?.background });
    },
    closeTab(tabId) {
      dispatch({ t: "closeTab", tabId: tabId ?? stateRef.current.activeTabId });
    },
    activateTab(tabId) {
      dispatch({ t: "activateTab", tabId });
    },
    cycleTab(dir) {
      dispatch({ t: "cycleTab", dir });
    },
    moveTab(tabId, to) {
      dispatch({ t: "moveTab", tabId, to });
    },
    async popOutTab(tabId) {
      const s = stateRef.current;
      const id = tabId ?? s.activeTabId;
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab || !s.folder || !s.activeRoot) return;
      const ok = await openConceptWindow(s.folder, s.activeRoot, tab.conceptId);
      // Tear-off semantics: the tab moves, it isn't copied — but only once the
      // window actually exists, and never below one tab.
      if (ok && stateRef.current.tabs.length > 1)
        dispatch({ t: "closeTab", tabId: id });
    },
    back() {
      dispatch({ t: "back" });
    },
    forward() {
      dispatch({ t: "fwd" });
    },
    setQuery(q) {
      dispatch({ t: "query", v: q });
    },
    toggleType(t) {
      dispatch({ t: "toggleType", v: t });
    },
    showAllTypes() {
      dispatch({ t: "showAllTypes" });
    },
    setTag(tag) {
      dispatch({ t: "tag", v: tag });
    },
    setLens(lens) {
      dispatch({ t: "lens", v: lens });
    },
    setVizView(view) {
      dispatch({ t: "vizView", v: view });
    },
    cycleViz() {
      dispatch({ t: "cycleViz" });
    },
    setGraphMode(mode) {
      dispatch({ t: "graphMode", v: mode });
    },
    setFocusDepth(depth) {
      dispatch({ t: "focusDepth", v: depth });
    },
    setLinkDensity(density) {
      dispatch({ t: "linkDensity", v: density });
    },
    setLayout(mode) {
      dispatch({ t: "layout", v: mode });
    },
    cycleLayout() {
      dispatch({ t: "cycleLayout" });
    },
    setPaneSize(pane, value) {
      dispatch({ t: "paneSize", pane, v: value });
    },
    setAgentPanelWidth(value) {
      dispatch({ t: "agentPanelWidth", v: value });
    },
    togglePanel(name, value) {
      dispatch({ t: "panel", name, v: value });
    },
    setPalette(open, seed) {
      dispatch({ t: "palette", v: open, seed });
    },
    openOkfTaskLauncher(origin, options) {
      const current = stateRef.current;
      const bundle = current.bundle;
      if (!bundle || !current.activeRoot) return;
      const request: OkfTaskLaunchRequest = {
        requestId: crypto.randomUUID(),
        origin,
        ...(options?.preferredTaskId
          ? { preferredTaskId: options.preferredTaskId }
          : {}),
        ...(options?.promptDraft
          ? { promptDraft: options.promptDraft }
          : {}),
        ...(options?.returnFocusId
          ? { returnFocusId: options.returnFocusId }
          : {}),
        openedBundleFingerprint: bundleContextFingerprint(
          current.activeRoot,
          bundle.concepts,
          bundle.issues,
        ),
      };
      dispatch({ t: "okfTaskLauncher", v: request });
      dispatch({ t: "panel", name: "agent", v: true });
    },
    closeOkfTaskLauncher(options) {
      const focusId = stateRef.current.okfTaskLauncher?.returnFocusId;
      dispatch({ t: "okfTaskLauncher", v: null });
      if (options?.restoreFocus !== false && focusId) {
        requestAnimationFrame(() => document.getElementById(focusId)?.focus());
      }
    },
    setSettingsOpen(open) {
      dispatch({ t: "settingsOpen", v: open });
    },
    setHelp(open) {
      dispatch({ t: "help", v: open });
    },
    updateSettings(patch) {
      const next = { ...stateRef.current.settings, ...patch };
      dispatch({ t: "settings", v: next });
      void ipc.saveSettings(next);
    },
    setUpdateStatus(status) {
      dispatch({ t: "updateStatus", v: status });
    },
    markUpdateSeen(version) {
      dispatch({ t: "updateSeen", v: version });
      saveUpdateSeenVersion(version);
    },
    openExternal(url) {
      void ipc.openExternal(url);
    },
    };
    return a;
  });

  // Load persisted settings once, and reopen the most recent folder if any
  // (first-run.md: "can reopen the last one automatically"). Auto-reopen is
  // desktop-only: off-Tauri the recents are a seeded fixture for the switcher
  // UI, and dev/tests should still boot into the first-run state.
  useEffect(() => {
    void (async () => {
      const s = await ipc.loadSettings();
      // Seed the ref before the auto-reopen so its scan reads the *persisted*
      // scanMaxDepth, not the default — dispatch only reaches stateRef next
      // render, and openRecentBundle reads the ref synchronously here.
      stateRef.current = { ...stateRef.current, settings: s };
      dispatch({ t: "settings", v: s });
      // A pop-out window boots straight onto its target bundle + concept
      // (passed in the query string by the opener) instead of the recents flow.
      if (bootTarget) {
        const bundles = await ipc.scanBundles(bootTarget.folder, s.scanMaxDepth);
        dispatch({ t: "openFolder", folder: bootTarget.folder, bundles });
        const root = bundles.some((b) => b.root === bootTarget.root)
          ? bootTarget.root
          : bundles[0]?.root;
        // Select first, then load: setBundle keeps a pre-selected concept that
        // exists in the incoming bundle, so the window lands on its target
        // with an empty history (no phantom Back entry).
        if (bootTarget.concept) actions.selectConcept(bootTarget.concept);
        if (root) await actions.selectBundle(root, bootTarget.folder);
        return;
      }
      const recents = await ipc.recentBundles();
      dispatch({ t: "recents", v: recents });
      if (recents.length > 0 && ipc.isTauri()) {
        await actions.openRecentBundle(recents[0]);
      }
      // The quiet update check behind the settings-icon badge: once per launch,
      // after boot has settled, main window only (the bootTarget path above
      // returns early, so pop-outs never phone out). Silent by design — only a
      // definite answer lands in the store; see updater.ts.
      if (s.updateNotify) {
        const status = await checkForUpdateQuietly();
        if (status) dispatch({ t: "updateStatus", v: status });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the window's maximized state for the custom frame (square corners when
  // maximized). No-op off-Tauri.
  useEffect(() => {
    if (!ipc.isTauri()) return;
    let unsub = () => {
      /* replaced once the resize listener is registered */
    };
    const sync = () =>
      void isWindowMaximized().then((m) => dispatch({ t: "maximized", v: m }));
    sync();
    void onWindowResized(sync).then((u) => {
      unsub = u;
    });
    return () => unsub();
  }, []);

  // Apply theme; re-apply on OS scheme change when following the system.
  useEffect(() => {
    applyTheme(state.settings.theme, state.settings.reduceMotion);
    if (state.settings.theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system", stateRef.current.settings.reduceMotion);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [state.settings.theme, state.settings.reduceMotion]);

  // Live reload: watch the active bundle's folder; re-read on change.
  useEffect(() => {
    const root = state.activeRoot;
    if (!root) return;
    let cancelled = false; // true once this effect (this root) is torn down
    let dispose: (() => void) | undefined;
    void ipc
      .startWatch(root, () => {
        void ipc.readBundle(root).then((bundle) => {
          // Drop a read that resolves after the user already switched roots —
          // otherwise a late callback dispatches setBundle for the *old* root
          // and clobbers the now-active bundle.
          if (!cancelled) dispatch({ t: "setBundle", root, bundle });
        });
      })
      .then((d) => {
        // If the effect was already torn down before startWatch resolved,
        // dispose immediately (the returned cleanup ran with dispose still
        // undefined) so the backend watch isn't leaked.
        if (cancelled) d();
        else dispose = d;
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [state.activeRoot]);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}

/** Subscribe to the store's state. Re-renders when the data changes. */
export function useAppState(): State {
  const s = useContext(StateCtx);
  if (s === null) throw new Error("useAppState must be used within AppProvider");
  return s;
}

/** The store's action set. A stable reference, so a component that reads only
 *  actions (no state) never re-renders on a data change. */
export function useAppActions(): Actions {
  const a = useContext(ActionsCtx);
  if (a === null) throw new Error("useAppActions must be used within AppProvider");
  return a;
}

/** Convenience for the common case that a component needs both. Subscribes to
 *  state (so it re-renders on data changes) — prefer useAppActions alone when a
 *  component only dispatches. */
export function useApp() {
  return { state: useAppState(), actions: useAppActions() };
}

/** Convenience: the currently selected concept, or null. */
export function useActiveConcept(): Concept | null {
  const state = useAppState();
  if (!state.bundle || !state.activeConceptId) return null;
  return state.bundle.concepts.find((c) => c.id === state.activeConceptId) ?? null;
}
