// Global Search Launcher — Ctrl/Cmd+K (or `/`, or the header search field).
// A single launcher that jumps to any concept by id/title/type, searches the
// full text of descriptions and bodies, surfaces recent concepts, and runs
// quick actions — keyboard-only. Filters over the already-parsed bundle, so
// results are instant. See docs/proposals/global-search.md and
// docs/features/command-palette.md.
//
// Built on Base UI's Dialog (modal focus trap, Escape, backdrop, scroll-lock,
// focus restore) wrapping an inline Autocomplete (arrow/typeahead navigation,
// active-item ARIA, Enter-to-select). Results are split into ordered groups via
// Autocomplete.Group + Autocomplete.Collection; we keep our own ranking
// (paletteSearch.ts) and hand the grouped result to Autocomplete via
// `filteredItems`, so the scoring and order survive.
//
// The states this has to hold, each with its own shape rather than one wall of
// rows:
//   no bundle   only what works without one.
//   zero query  recent concepts and a short suggested set, not all nineteen
//               actions.
//   results     ranked across groups, with the matched characters marked so a
//               fuzzy hit reads as a hit rather than as an arbitrary row.
//   capped      says so, instead of silently dropping the 31st concept.
//   no match    names what was searched and what was searched over, and leaves
//               the actions that still work in reach.

import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { useApp } from "@/shared/store.tsx";
import { focusAgentPanel, focusAgentPanelOpener } from "@/features/agent/agentPanelFocus.ts";
import { focusGitPanel, focusGitPanelOpener } from "@/features/git/gitPanelFocus.ts";
import type { Concept } from "@/shared/types.ts";
import { scoreFields, scoreQuery, segment, type RecordMatch } from "@/features/shell/paletteSearch.ts";
import { buildTypePalette, resolveDark } from "@/shared/theme.ts";
import { OKF_TASKS } from "@/features/agent/taskContext.ts";
import { tasksForOkfOrigin, type OkfTaskOrigin } from "@/features/agent/taskLauncher.ts";
import "@/shared/styles/chrome.css";
import "@/shared/styles/baseui.css";
import "./CommandPalette.css";

interface ActionItem {
  kind: "action";
  id: string;
  label: string;
  /** Shown at the row's right edge. Empty for plain actions: the group heading
   *  already says ACTIONS, and repeating it nineteen times is noise. */
  hint: string;
  /** What has to be open for this to do anything. */
  needs?: "bundle" | "concept";
  /** Offered in the zero state, before the reader has typed. */
  suggested?: boolean;
  run: () => void;
}

interface ConceptItem {
  kind: "concept";
  id: string;
  concept: Concept;
  score: number;
  /** Where the query matched the title, for marking it in the row. */
  positions?: readonly number[];
  /** A highlighted snippet for "In text" hits; absent for plain title hits. */
  snippet?: SnippetPart[];
}

type Item = ActionItem | ConceptItem;

/** One group of results. `value` is the visible label (and groups Base UI). */
interface Group {
  value: string;
  items: Item[];
}

/** A slice of snippet text; `match` parts are visually highlighted. */
interface SnippetPart {
  text: string;
  match: boolean;
}

const RECENT_LIMIT = 5;
const CONCEPT_LIMIT = 30;
const TEXT_LIMIT = 20;
const SNIPPET_PAD = 32;

/**
 * Score a concept for the Concepts group. Title leads; id and type follow it
 * closely because both are things people search by here; description and tags
 * carry least, but including them means a concept whose description says what
 * you are looking for ranks here rather than only in the slower "In text" pass.
 *
 * Only the title's positions are kept, since the title is the only field the
 * row renders in full.
 */
function scoreConcept(c: Concept, needle: string): RecordMatch {
  return scoreFields(
    [
      { value: c.title, weight: 1, highlight: true },
      { value: c.id, weight: 0.9 },
      { value: c.type, weight: 0.7 },
      { value: c.description, weight: 0.5 },
      { value: c.tags.join(" "), weight: 0.5 },
    ],
    needle,
  );
}

/**
 * Reduce markdown to the prose a reader would see, so a snippet quotes the
 * sentence rather than its source and the matched word is not buried in
 * punctuation.
 *
 * Fences are tracked line by line rather than matched with a non-greedy regex.
 * A `/```[\s\S]*?```/` pairs the wrong delimiters the moment a document
 * *documents* a fence — the concept reader's own body shows one inside a
 * four-backtick span, which offsets every pair after it and leaves the real
 * Mermaid block in the prose.
 */
function plainText(text: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s{0,3}`{3,}/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines.push(line);
  }
  return lines
    .join("\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images keep their alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/<[^>]+>/g, "") // inline HTML tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s{0,3}[-*+]\s+|^\s{0,3}>\s?/gm, "") // list and quote markers
    .replace(/^\[[ xX]\]\s+/gm, "") // task-list checkboxes, once the dash is off
    .replace(/[*_`|]/g, "") // emphasis, code ticks, table pipes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a one-line highlighted snippet around the first occurrence of `needle`
 * in `text`, or null if the (case-insensitive) substring isn't present. Newlines
 * collapse to spaces so the snippet stays single-line.
 */
function buildSnippet(text: string, needle: string): SnippetPart[] | null {
  const flat = plainText(text);
  const idx = flat.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return null;

  const start = Math.max(0, idx - SNIPPET_PAD);
  const end = Math.min(flat.length, idx + needle.length + SNIPPET_PAD);
  const parts: SnippetPart[] = [];
  if (start > 0) parts.push({ text: "…", match: false });
  if (idx > start) parts.push({ text: flat.slice(start, idx), match: false });
  parts.push({ text: flat.slice(idx, idx + needle.length), match: true });
  if (end > idx + needle.length) {
    parts.push({ text: flat.slice(idx + needle.length, end), match: false });
  }
  if (end < flat.length) parts.push({ text: "…", match: false });
  return parts;
}

/** Display label for an item — used by Autocomplete for ARIA/typeahead. */
function itemLabel(item: Item): string {
  return item.kind === "concept" ? item.concept.title : item.label;
}

export function CommandPalette() {
  const { state, actions } = useApp();
  // Controlled input value: we need the query to compute the ranked, grouped
  // result set ourselves (Autocomplete's built-in collator filter can't
  // reproduce our prefix/word-boundary/subsequence scoring or grouping).
  const [query, setQuery] = useState("");
  // One-shot seed hand-off (the sidebar's "Open full search" passes its query
  // along): applied once per open, via the adjust-state-during-render pattern,
  // so the user continues the same search instead of retyping it.
  const [appliedSeed, setAppliedSeed] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  if (state.palette && state.paletteSeed != null && appliedSeed !== state.paletteSeed) {
    setAppliedSeed(state.paletteSeed);
    setQuery(state.paletteSeed);
  }

  const close = () => actions.setPalette(false);

  const actionItems: ActionItem[] = [
    {
      kind: "action",
      id: "act:open",
      label: "Open folder…",
      hint: "",
      suggested: true,
      run: () => void actions.openFolder(),
    },
    {
      kind: "action",
      id: "act:open-url",
      label: "Open from URL…",
      hint: "",
      suggested: true,
      run: () => actions.setRemoteOpen(true),
    },
    {
      kind: "action",
      id: "act:overview",
      label: "Bundle home",
      hint: "",
      needs: "bundle",
      suggested: true,
      run: () => actions.setOverview(true),
    },
    {
      kind: "action",
      id: "act:bundle-details",
      label: "Open bundle details",
      hint: "",
      needs: "bundle",
      run: () => actions.setBundleDetailsOpen(true),
    },
    {
      kind: "action",
      id: "act:delegation-plan",
      label: "Plan delegated work",
      hint: "",
      needs: "bundle",
      run: () => actions.setDelegationPlanOpen(true),
    },
    {
      kind: "action",
      id: "act:intake-plan",
      label: "Plan document intake",
      hint: "",
      needs: "bundle",
      run: () => actions.setIntakePlanOpen(true),
    },
    {
      kind: "action",
      id: "act:bundle-connections",
      label: "Manage bundle connections",
      hint: "",
      needs: "bundle",
      run: () => actions.setConnectionsOpen(true),
    },
    {
      kind: "action",
      id: "act:relationship-exchange",
      label: "Exchange JSON-LD relationships",
      hint: "",
      needs: "bundle",
      run: () => actions.setConnectionsOpen(true),
    },
    {
      kind: "action",
      id: "act:share-bundle",
      label: "Create shareable bundle",
      hint: "",
      needs: "bundle",
      run: () => actions.setProjectionOpen(true),
    },
    {
      kind: "action",
      id: "act:rescan",
      label: "Re-scan folder",
      hint: "",
      needs: "bundle",
      run: () => void actions.rescan(),
    },
    {
      kind: "action",
      id: "act:lineage",
      label: "Trace lineage",
      hint: "",
      needs: "concept",
      run: () => actions.togglePanel("lineage", true),
    },
    {
      kind: "action",
      id: "act:log",
      label: "Toggle log",
      hint: "",
      needs: "bundle",
      run: () => actions.togglePanel("log"),
    },
    {
      kind: "action",
      id: "act:popout",
      label: "Move concept to new window",
      hint: "",
      needs: "concept",
      run: () => void actions.popOutTab(),
    },
    {
      kind: "action",
      id: "act:viz-graph",
      label: "View: Graph",
      hint: "",
      needs: "bundle",
      run: () => actions.setVizView("graph"),
    },
    {
      kind: "action",
      id: "act:viz-treemap",
      label: "View: Treemap",
      hint: "",
      needs: "bundle",
      run: () => actions.setVizView("treemap"),
    },
    {
      kind: "action",
      id: "act:viz-sunburst",
      label: "View: Sunburst",
      hint: "",
      needs: "bundle",
      run: () => actions.setVizView("sunburst"),
    },
    {
      kind: "action",
      id: "act:viz-pack",
      label: "View: Circle packing",
      hint: "",
      needs: "bundle",
      run: () => actions.setVizView("pack"),
    },
    {
      kind: "action",
      id: "act:agent",
      label: "Toggle agent panel",
      hint: "",
      suggested: true,
      run: () => {
        actions.togglePanel("agent");
        if (state.panels.agent) focusAgentPanelOpener();
        else focusAgentPanel();
      },
    },
    {
      kind: "action",
      id: "act:git",
      label: "Toggle Git panel",
      hint: "",
      needs: "bundle",
      run: () => {
        actions.togglePanel("git");
        if (state.panels.git) focusGitPanelOpener();
        else focusGitPanel();
      },
    },
    {
      kind: "action",
      id: "act:settings",
      label: "Settings",
      hint: "",
      suggested: true,
      run: () => actions.setSettingsOpen(true),
    },
    {
      kind: "action",
      id: "act:shortcuts",
      label: "Keyboard shortcuts",
      hint: "",
      suggested: true,
      run: () => actions.setHelp(true),
    },
  ];

  const concepts = state.bundle?.concepts ?? [];
  const byId = new Map(concepts.map((c) => [c.id, c] as const));
  // The same type→color encoding the graph, sidebar, and reader use, so a
  // result is recognizable by its left edge before the title is read. The
  // references all lead a row with an icon; we already have a stronger signal.
  const typePalette = buildTypePalette(
    concepts.map((c) => c.type),
    resolveDark(state.settings.theme),
  );

  // Only offer what the current state can actually carry out.
  const available = actionItems.filter((a) =>
    a.needs === "bundle"
      ? state.bundle != null
      : a.needs === "concept"
        ? state.activeConceptId != null
        : true,
  );

  const conceptItem = (concept: Concept, score = 0): ConceptItem => ({
    kind: "concept",
    id: concept.id,
    concept,
    score,
  });

  // Recent: distinct, most-recent-first concept ids the user viewed. `back` is
  // chronological (oldest→newest prior view); the active concept is the latest.
  // Derived from existing state — no store change. See proposal.
  const recentItems: ConceptItem[] = [];
  const seenRecent = new Set<string>();
  const recentIds = [...state.back, state.activeConceptId].reverse();
  for (const id of recentIds) {
    if (!id || seenRecent.has(id)) continue;
    const c = byId.get(id);
    if (!c) continue;
    seenRecent.add(id);
    recentItems.push(conceptItem(c));
    if (recentItems.length >= RECENT_LIMIT) break;
  }

  const needle = query.trim();

  // Concepts: fuzzy/substring matches on title/id/type. Title/prefix hits rank
  // first (handled by scoreConcept). Empty query shows Recent + Actions instead
  // (the zero-query state), so this group is empty until the user types.
  const rankedConcepts = needle
    ? concepts
        .map((c) => ({ c, hit: scoreConcept(c, needle) }))
        .filter(({ hit }) => hit.score >= 0)
        .sort((a, b) => b.hit.score - a.hit.score || a.c.title.localeCompare(b.c.title))
    : [];
  // Kept so the list can say it is showing the first thirty of more.
  const conceptTotal = rankedConcepts.length;
  const conceptHits: ConceptItem[] = rankedConcepts
    .slice(0, CONCEPT_LIMIT)
    .map(({ c, hit }) => ({ ...conceptItem(c, hit.score), positions: hit.positions }));

  // In text: concepts whose description or body contains the query and that
  // aren't already a strong (Concepts-group) hit. Render a snippet around it.
  const strongHits = new Set(conceptHits.map((it) => it.id));
  const textHits: ConceptItem[] = needle
    ? concepts
        .filter((c) => !strongHits.has(c.id))
        .map((c): ConceptItem | null => {
          const snippet =
            buildSnippet(c.description, needle) ?? buildSnippet(c.body, needle);
          return snippet ? { ...conceptItem(c), snippet } : null;
        })
        .filter((it): it is ConceptItem => it !== null)
        .slice(0, TEXT_LIMIT)
    : [];

  const taskConcept = needle
    ? conceptHits[0]?.concept ?? textHits[0]?.concept
    : byId.get(state.activeConceptId ?? "");
  const taskOrigin: OkfTaskOrigin | null = taskConcept
    ? {
        kind: needle ? "search-result" : "concept",
        id: `${needle ? "search" : "concept"}:${taskConcept.id}`,
        title: taskConcept.title,
        conceptId: taskConcept.id,
      }
    : null;
  const taskActions: ActionItem[] = taskOrigin
    ? tasksForOkfOrigin(taskOrigin).map((taskId) => ({
        kind: "action",
        id: `task:${taskId}:${taskOrigin.id}`,
        label: `${OKF_TASKS[taskId].title}: ${taskOrigin.title}`,
        hint: "OKF task",
        run: () => actions.openOkfTaskLauncher(taskOrigin, {
          preferredTaskId: taskId,
          returnFocusId: "topbar-search",
        }),
      }))
    : [];
  const matchingIssue = taskConcept
    ? state.bundle?.issues.find((issue) => issue.conceptId === taskConcept.id)
    : undefined;
  if (matchingIssue) {
    const issueOrigin: OkfTaskOrigin = {
      kind: "validation-finding",
      id: `validation:${matchingIssue.level}:${taskConcept?.id}:${matchingIssue.message}`,
      title: taskConcept?.title ?? "Validation finding",
      issue: matchingIssue,
    };
    taskActions.unshift({
      kind: "action",
      id: `task:okf-repair:${issueOrigin.id}`,
      label: `Repair validation issue: ${taskConcept?.title}`,
      hint: "OKF task",
      run: () => actions.openOkfTaskLauncher(issueOrigin, {
        preferredTaskId: "okf-repair",
        returnFocusId: "topbar-search",
      }),
    });
  }

  // Ranked the same way concepts are, so a strong action match and a strong
  // concept match are comparable when the groups are ordered below. With no
  // query only the suggested few lead, because nineteen commands is not a
  // starting point — it is a list to escape from.
  const rankedActions: { item: ActionItem; score: number }[] = needle
    ? available
        .map((a) => ({ item: a, score: scoreQuery(a.label, needle).score }))
        .filter(({ score }) => score >= 0)
        .sort((x, y) => y.score - x.score)
    : available.filter((a) => a.suggested).map((item) => ({ item, score: 0 }));
  const actionHits: ActionItem[] = rankedActions.map(({ item }) => item);

  // Group order. With a query the two competing groups are ordered by their own
  // best match, so typing "agent" leads with the Agent Panel concept rather
  // than with whichever action happened to be declared first.
  //
  // Two orderings are NOT left to the score. Recent leads the zero state
  // because that is what a launcher opened without a query is for. And OKF
  // tasks always follow Concepts, never lead: the spec's rule is that Enter
  // opens the best navigation match instead of unexpectedly starting agent
  // work, and a task row scoring well must not take the first slot.
  const groups: Group[] = [];
  if (!needle) {
    if (recentItems.length) groups.push({ value: "Recent", items: recentItems });
    if (actionHits.length) groups.push({ value: "Actions", items: actionHits });
  } else {
    const ranked: { group: Group; score: number }[] = [];
    if (conceptHits.length) {
      ranked.push({ group: { value: "Concepts", items: conceptHits }, score: conceptHits[0].score });
    }
    if (actionHits.length) {
      ranked.push({ group: { value: "Actions", items: actionHits }, score: rankedActions[0].score });
    }
    ranked.sort((a, b) => b.score - a.score);
    for (const { group } of ranked) {
      groups.push(group);
      // Task shortcuts sit with the concept they act on.
      if (group.value === "Concepts" && taskActions.length) {
        groups.push({ value: "OKF tasks", items: taskActions });
      }
    }
    if (!conceptHits.length && taskActions.length) {
      groups.push({ value: "OKF tasks", items: taskActions });
    }
    if (textHits.length) groups.push({ value: "In text", items: textHits });
  }

  const resultCount = groups.reduce((n, g) => n + g.items.length, 0);

  // Offered when nothing matched. Always-available commands only — the point is
  // a way forward, so it must not itself be empty or full of no-ops.
  const emptyActions = available.filter((a) => a.needs == null && a.suggested).slice(0, 3);

  function activate(item: Item, e?: ReactMouseEvent) {
    if (item.kind === "concept") {
      // Ctrl/Cmd+click opens the result in a background tab (Shift to also
      // switch) — the browser gesture. See docs/proposals/multi-view.md.
      if (e && (e.ctrlKey || e.metaKey)) {
        actions.openInNewTab(item.id, { background: !e.shiftKey });
      } else {
        actions.selectConcept(item.id); // store also closes the palette
      }
      close();
    } else {
      close();
      item.run();
    }
  }

  return (
    <Dialog.Root
      open={state.palette}
      onOpenChange={(open) => {
        actions.setPalette(open);
        if (!open) {
          setQuery(""); // clear the search when the palette closes
          setAppliedSeed(null); // …so an identical seed can apply next time
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop" />
        <Dialog.Popup
          className="ui-dialog palette-dialog"
          aria-label="Search and commands"
          initialFocus={inputRef}
        >
          <Autocomplete.Root
            // Inline: render the list directly in the dialog, no nested popup.
            // `open` is bound to the dialog so transient state resets on close.
            // `items` and `filteredItems` must share the same grouped shape: a
            // flattened `items` makes the combobox treat the list as ungrouped,
            // so its keyboard-navigation index walks the groups instead of the
            // items inside them and arrows stall after one or two presses.
            inline
            open={state.palette}
            items={groups}
            filteredItems={groups}
            value={query}
            onValueChange={(value) => setQuery(value)}
            itemToStringValue={itemLabel}
            autoHighlight
          >
            <div className="palette-search">
              <Autocomplete.Input
                ref={inputRef}
                className="palette-input"
                placeholder="Search concepts and text, or run a command…"
              />
              {/* A cap that is also the control it names. */}
              <Dialog.Close className="kbd palette-esc" aria-label="Close search">
                esc
              </Dialog.Close>
            </div>

            <Autocomplete.List className="palette-list" aria-label="Results">
              {(group: Group) => (
                <Autocomplete.Group
                  key={group.value}
                  items={group.items}
                  className="palette-group"
                >
                  <Autocomplete.GroupLabel className="palette-group-label">
                    {group.value}
                    <span className="palette-group-count">{group.items.length}</span>
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(item: Item) => (
                      <Autocomplete.Item
                        key={`${item.kind}:${item.id}`}
                        value={item}
                        className="palette-item"
                        onClick={(e) => activate(item, e)}
                      >
                        <span
                          className="palette-dot"
                          style={
                            item.kind === "concept"
                              ? { background: typePalette.color(item.concept.type) }
                              : undefined
                          }
                          aria-hidden="true"
                        />
                        {item.kind === "concept" ? (
                          <ConceptRow item={item} />
                        ) : (
                          <>
                            <span className="palette-label">{item.label}</span>
                            {item.hint && (
                              <span className="palette-meta">
                                <span className="palette-hint">{item.hint}</span>
                              </span>
                            )}
                          </>
                        )}
                        <span className="palette-enter" aria-hidden="true">
                          ↵
                        </span>
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>

            <Autocomplete.Empty className="palette-empty">
              <p className="palette-empty-title">
                No match for <strong>{needle}</strong>
              </p>
              <p className="palette-empty-hint muted">
                {state.bundle
                  ? "Searched concept titles, ids, types, tags, descriptions, and body text."
                  : "No folder is open, so there is nothing to search yet."}
              </p>
              <div className="palette-empty-actions">
                {emptyActions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="btn"
                    onClick={() => {
                      close();
                      a.run();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </Autocomplete.Empty>
          </Autocomplete.Root>

          <div className="ui-dialog-foot palette-foot muted">
            <span className="kbd-hints" aria-hidden="true">
              <span className="kbd-hint">
                <span className="hint-key">↑↓</span> navigate
              </span>
              <span className="kbd-hint">
                <span className="hint-key">↵</span> open
              </span>
            </span>
            {/* A live count, because the list is capped and silently dropping
                results is worse than saying so. */}
            <span className="palette-count" role="status">
              {needle && resultCount > 0
                ? conceptTotal > CONCEPT_LIMIT
                  ? `${resultCount} shown · ${conceptTotal} concepts match`
                  : `${resultCount} result${resultCount === 1 ? "" : "s"}`
                : ""}
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Title text with the characters the query matched marked. This is what makes
 *  a subsequence hit legible: without it, "gv" returning "Graph View" looks
 *  like the launcher guessed. */
function Marked({ text, positions }: { text: string; positions?: readonly number[] }) {
  if (!positions?.length) return <>{text}</>;
  return (
    <>
      {segment(text, positions).map((part, i) =>
        part.match ? (
          <mark key={i} className="palette-mark">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A concept result row: title + type/id meta, with an optional text snippet. */
function ConceptRow({ item }: { item: ConceptItem }) {
  return (
    <span className="palette-row">
      <span className="palette-row-main">
        <span className="palette-label">
          <Marked text={item.concept.title} positions={item.positions} />
        </span>
        <span className="palette-meta">
          <span className="palette-type">{item.concept.type}</span>
          <span className="palette-id">{item.concept.id}</span>
        </span>
      </span>
      {item.snippet && (
        <span className="palette-snippet">
          {item.snippet.map((part, i) =>
            part.match ? (
              <mark key={i} className="palette-mark">
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </span>
      )}
    </span>
  );
}
