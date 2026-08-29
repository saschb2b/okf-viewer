import { useEffect, useRef, useSyncExternalStore } from "react";
import type * as React from "react";
import { useApp, paneClamp, workspaceFloor } from "@/shared/store.tsx";
import { useGlobalKeys } from "@/keys.ts";
import { TopBar } from "@/features/shell/components/TopBar.tsx";
import { ActivityBar } from "@/features/shell/components/ActivityBar.tsx";
import { StatusBar } from "@/features/shell/components/StatusBar.tsx";
import { Sidebar } from "@/features/navigation/components/Sidebar.tsx";
import { VizPane } from "@/features/viz/components/VizPane.tsx";
import { Reader } from "@/features/reader/components/Reader.tsx";
import { TabStrip } from "@/features/shell/components/TabStrip.tsx";
import { CommandPalette } from "@/features/shell/components/CommandPalette.tsx";
import { ValidationPanel } from "@/features/shell/components/ValidationPanel.tsx";
import { LineagePanel } from "@/features/reader/components/LineagePanel.tsx";
import { LogView } from "@/features/shell/components/LogView.tsx";
import { Settings } from "@/features/shell/components/Settings.tsx";
import { EmptyState } from "@/features/shell/components/EmptyState.tsx";
import { OpenRemoteDialog } from "@/features/bundle/components/OpenRemoteDialog.tsx";
import { CreateBundleDialog } from "@/features/bundle/components/CreateBundleDialog.tsx";
import { RecipientProjectionDialog } from "@/features/bundle/components/RecipientProjectionDialog.tsx";
import { BundleDetailsDialog } from "@/features/bundle/components/BundleDetailsDialog.tsx";
import { ConnectionsDialog } from "@/features/bundle/components/ConnectionsDialog.tsx";
import { DelegationPlanDialog } from "@/features/agent/components/DelegationPlanDialog.tsx";
import { IntakePlanDialog } from "@/features/agent/components/IntakePlanDialog.tsx";
import { ExternalEntryDialog } from "@/features/bundle/components/ExternalEntryDialog.tsx";
import { BundleHome } from "@/features/bundle/components/BundleHome.tsx";
import { ResizeHandles } from "@/features/shell/components/ResizeHandles.tsx";
import { ShortcutsHelp } from "@/features/shell/components/ShortcutsHelp.tsx";
import { AgentPanel } from "@/features/agent/components/AgentPanel.tsx";
import { GitPanel } from "@/features/git/components/GitPanel.tsx";
import { GitDiffWorkspace } from "@/features/git/components/GitDiffWorkspace.tsx";
import { closeGitDiff, useGitDiff } from "@/features/git/gitRepositoryStore.ts";
import { AgentPanelStateGallery } from "@/mock/AgentPanelStateGallery.tsx";
import { showWindowWhenPainted } from "@/shared/platform/window.ts";

const OVERVIEW_WITH_SIDEBAR_MIN_WIDTH = 704;

function subscribeWindowResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function App() {
  const { state, actions } = useApp();
  const gitDiff = useGitDiff();
  useGlobalKeys();
  const windowWidth = useSyncExternalStore(
    subscribeWindowResize,
    () => window.innerWidth,
    () => 1280,
  );

  // Reveal the hidden OS window on the first painted frame. Created visible,
  // the transparent borderless shell sits on screen as an empty rectangle for
  // the whole webview boot; created hidden, the app pops in fully drawn.
  // Double rAF so the reveal lands after the first frame has actually
  // painted; harmless if repeated (StrictMode re-mounts, pop-out windows).
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => void showWindowWhenPainted());
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    closeGitDiff();
  }, [state.activeRoot]);

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("agent-gallery")
  ) {
    return <AgentPanelStateGallery />;
  }

  // The open agent panel takes over the whole content area when what remains
  // beside it cannot hold the visible panes at their compressed floors. This
  // follows the actual panel width instead of a fixed viewport breakpoint, so
  // a shrinking window hands over instead of clipping panes. Divider drags
  // cannot cause this: the panel width clamp stops at the same floor.
  const agentPanelWidth = state.agentPanelWidth ??
    Math.min(440, Math.max(320, Math.round(windowWidth * 0.3)));
  const agentTakeover = state.panels.agent &&
    windowWidth - 48 - agentPanelWidth < workspaceFloor(state);
  const gitTakeover = state.panels.git &&
    windowWidth - 48 - Math.min(440, Math.max(320, Math.round(windowWidth * 0.3))) < workspaceFloor(state);

  return (
    <div className="app" data-maximized={state.maximized || undefined}>
      <TopBar />
      <div
        className="app-main"
        data-agent-takeover={agentTakeover || undefined}
        data-git-takeover={gitTakeover || undefined}
      >
        <ActivityBar />
        {state.bundle
          ? gitDiff.open
            ? <GitDiffWorkspace />
            : <Workspace windowWidth={windowWidth} />
          : <EmptyState />}
        <AgentPanel />
        <GitPanel />
      </div>
      <StatusBar />

      {/* Base UI Dialogs: mounted whenever a bundle is open; their `open` prop
          (from store state) drives visibility, so they manage their own
          focus/Escape/transitions. */}
      {state.bundle && (
        <>
          <LogView />
          <ValidationPanel />
          <LineagePanel />
          <RecipientProjectionDialog
            open={state.projectionOpen}
            bundle={state.bundle}
            onOpenChange={(open) => actions.setProjectionOpen(open)}
          />
          <BundleDetailsDialog
            open={state.bundleDetailsOpen}
            bundle={state.bundle}
            onOpenChange={(open) => actions.setBundleDetailsOpen(open)}
          />
          <ConnectionsDialog
            open={state.connectionsOpen}
            bundle={state.bundle}
            onOpenChange={(open) => actions.setConnectionsOpen(open)}
          />
          <DelegationPlanDialog
            open={state.delegationPlanOpen}
            bundle={state.bundle}
            root={state.activeRoot}
            onOpenChange={(open) => actions.setDelegationPlanOpen(open)}
          />
          <IntakePlanDialog
            open={state.intakePlanOpen}
            root={state.activeRoot}
            onOpenChange={(open) => actions.setIntakePlanOpen(open)}
            onStartThread={(origin) =>
              actions.openOkfTaskLauncher(origin, { preferredTaskId: "okf-enrich" })
            }
          />
        </>
      )}
      {/* Settings, the shortcuts overlay, the launcher, and Open-from-URL work
          without a bundle (Open-from-URL is a first-run entry point); always
          mounted. The launcher used to be inside the bundle-only block above,
          which made Ctrl/Cmd+K a dead key on the empty state: the handler ran,
          called preventDefault, and flipped `palette` in the store with nothing
          mounted to render it. It now opens on the actions that work with no
          folder open — Open folder, Open from URL, Settings, and the rest are
          filtered out by what they need. */}
      <Settings />
      <CommandPalette />
      <ShortcutsHelp />
      <OpenRemoteDialog />
      <CreateBundleDialog />
      <ExternalEntryDialog />

      {/* Borderless-window resize handles (Tauri only). */}
      <ResizeHandles />
    </div>
  );
}

/**
 * The three-pane workspace. The active layout mode (`state.layout`) decides
 * which panes render and which dividers exist; the grid track widths come from
 * `state.paneSizes` (px when the user has dragged, otherwise a CSS default).
 * See docs/proposals/reader-first-layout.md.
 */
function Workspace({ windowWidth }: { windowWidth: number }) {
  const { state } = useApp();
  const ref = useRef<HTMLDivElement>(null);

  const showSidebar = state.panels.sidebar;

  // Overview takes over the content area: sidebar (if open) + the overview,
  // which scrolls its own content. Selecting any concept dismisses it.
  if (state.overview) {
    // Reserve enough room for both a useful navigation column and a readable
    // Home canvas. The stored sidebar preference remains unchanged, so it
    // returns when the window grows or the user opens a concept.
    const showOverviewSidebar =
      showSidebar && windowWidth >= OVERVIEW_WITH_SIDEBAR_MIN_WIDTH;
    const sidebarTrack =
      showOverviewSidebar && state.paneSizes.sidebar !== null
        ? `minmax(160px, ${state.paneSizes.sidebar}px)`
        : showOverviewSidebar
          ? "minmax(160px, var(--sidebar-default))"
          : null;
    return (
      <div
        ref={ref}
        className="workspace"
        data-layout="overview"
        style={{
          gridTemplateColumns: [sidebarTrack, "minmax(0, 1fr)"]
            .filter(Boolean)
            .join(" "),
        }}
      >
        {showOverviewSidebar && (
          <aside className="pane sidebar">
            <Sidebar />
          </aside>
        )}
        <BundleHome />
      </div>
    );
  }

  // reader pane visible: in split (unless `]` collapsed it) and reader mode.
  const showReader =
    (state.layout === "split" && state.panels.reader) ||
    state.layout === "reader";
  // graph pane visible: in split and graph mode.
  const showGraph = state.layout === "split" || state.layout === "graph";

  // Pane widths flow through CSS variables (not baked into the template string)
  // so a divider drag can update the width imperatively — writing the variable
  // on every pointermove instead of dispatching to the store, which would
  // re-render every useApp() consumer 60×/s. A sidebar width of `null` falls
  // back to its default token; the reader's `null` keeps its co-equal fractional
  // weight so a fresh split favors content. The graph always takes the 1fr.
  const sidebarWidth = showSidebar
    ? state.paneSizes.sidebar !== null
      ? `${state.paneSizes.sidebar}px`
      : "var(--sidebar-default)"
    : null;
  const readerWidth = showReader
    ? state.paneSizes.reader !== null
      ? `${state.paneSizes.reader}px`
      : "var(--reader-default)"
    : null;

  // Dividers only exist in split mode, where a drag has another pane to give
  // width to. Each one occupies its own narrow grid track.
  const splitMode = state.layout === "split";
  const sidebarDivider = showSidebar && splitMode && showGraph;
  const readerDivider = showGraph && showReader && splitMode;

  // Interleave pane tracks and divider tracks so the grid template lists every
  // child's column (sidebar | div | graph | div | reader).
  // Sidebar and reader tracks can compress below their preferred width down to
  // a usable floor before anything clips, so a wide agent panel squeezes the
  // workspace gracefully until the panel takes over entirely.
  const columns = [
    showSidebar ? "minmax(160px, var(--pane-sidebar))" : null,
    sidebarDivider ? "var(--divider-w)" : null,
    showGraph ? "minmax(var(--graph-min), 1fr)" : null,
    readerDivider ? "var(--divider-w)" : null,
    // In reader-only mode the reader takes the elastic space; otherwise its
    // track sizes the pane and the graph flexes.
    showReader ? (showGraph ? "minmax(220px, var(--pane-reader))" : "minmax(0, 1fr)") : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={ref}
      className="workspace"
      data-layout={state.layout}
      style={
        {
          gridTemplateColumns: columns,
          "--pane-sidebar": sidebarWidth ?? undefined,
          "--pane-reader": readerWidth ?? undefined,
        } as React.CSSProperties
      }
    >
      {showSidebar && (
        <aside className="pane sidebar">
          <Sidebar />
        </aside>
      )}

      {sidebarDivider && <Divider pane="sidebar" gridRef={ref} />}

      {showGraph && (
        <main className="pane graph">
          <VizPane />
        </main>
      )}

      {readerDivider && <Divider pane="reader" gridRef={ref} />}

      {/* The reader section is named because a section only becomes a landmark
          once it has an accessible name. Unnamed, everything inside it counted
          as content outside any landmark. */}
      {showReader && (
        <section className="pane reader" aria-label="Concept reader">
          {/* Sticky strip above the document; renders nothing below 2 tabs. */}
          <TabStrip />
          <Reader />
        </section>
      )}
    </div>
  );
}

/**
 * A keyboard-operable, draggable column divider.
 *
 * - `pane` is the track it resizes (`sidebar` measured from its left edge, or
 *   `reader` measured from the grid's right edge).
 * - Drag with the pointer, or focus and use arrow keys. Double-click (or
 *   Home/End) resets the track to its CSS default.
 */
function Divider({
  pane,
  gridRef,
}: {
  pane: "sidebar" | "reader";
  gridRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { state, actions } = useApp();
  const clamp = paneClamp(pane);
  // A focusable role="separator" requires aria-valuenow; when the pane is at its
  // CSS default (no dragged px), report the clamp midpoint as a best effort.
  const valueNow =
    state.paneSizes[pane] ?? Math.round((clamp.min + clamp.max) / 2);

  function current(): number {
    const stored = state.paneSizes[pane];
    if (stored !== null) return stored;
    // Default state: read the rendered track width so the first drag continues
    // smoothly from wherever the default put it.
    const grid = gridRef.current;
    const sel = pane === "sidebar" ? ".sidebar" : ".reader";
    const el = grid?.querySelector(sel) as HTMLElement | null;
    return el?.getBoundingClientRect().width ?? clamp.min;
  }

  function widthFromPointer(clientX: number): number {
    const grid = gridRef.current;
    if (!grid) return current();
    const rect = grid.getBoundingClientRect();
    // sidebar grows to the right; reader grows to the left.
    return pane === "sidebar"
      ? clientX - rect.left
      : rect.right - clientX;
  }

  // Teardown for an in-flight drag, so window listeners can't outlive the
  // divider if it unmounts mid-drag (a layout-mode change removing the track).
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Suppress the column-track transition during the drag so it tracks the
    // pointer 1:1 (the transition is only wanted for mode changes).
    gridRef.current?.classList.add("dragging");
    // Drag imperatively: write the pane's CSS variable on each move instead of
    // dispatching to the store, so the whole app doesn't re-render 60×/s. Commit
    // the final width to the store once on release (persist + a single render).
    let latest: number | null = null;
    const move = (ev: PointerEvent) => {
      const w = Math.min(clamp.max, Math.max(clamp.min, widthFromPointer(ev.clientX)));
      latest = w;
      gridRef.current?.style.setProperty(`--pane-${pane}`, `${w}px`);
    };
    const up = () => {
      gridRef.current?.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragCleanupRef.current = null;
      if (latest !== null) actions.setPaneSize(pane, latest);
    };
    dragCleanupRef.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 48 : 16;
    // Arrow direction maps to "wider" depending on which side the pane sits.
    const grow = pane === "sidebar" ? "ArrowRight" : "ArrowLeft";
    const shrink = pane === "sidebar" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) {
      e.preventDefault();
      actions.setPaneSize(pane, current() + step);
    } else if (e.key === shrink) {
      e.preventDefault();
      actions.setPaneSize(pane, current() - step);
    } else if (e.key === "Home" || e.key === "End" || e.key === "Enter") {
      e.preventDefault();
      actions.setPaneSize(pane, null); // reset to default
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a focusable window-splitter separator is interactive (WAI-ARIA APG)
    <div
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={
        pane === "sidebar" ? "Resize sidebar" : "Resize reader"
      }
      aria-valuemin={clamp.min}
      aria-valuemax={clamp.max}
      aria-valuenow={valueNow}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => actions.setPaneSize(pane, null)}
      onKeyDown={onKeyDown}
    />
  );
}
