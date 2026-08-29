// families.ts: the one owner of product capability copy. Each capability
// family has a stable id, a homepage outcome, detail-page capability groups,
// proof assets, documentation links, and related workflows. Pages compose
// these records; they do not fork the factual copy.

import { routes } from "./routes";
import { doc } from "./site";
import type { NavLink } from "./nav";

export interface Capability {
  title: string;
  body: string;
}

export interface CapabilityGroup {
  title: string;
  lede: string;
  items: Capability[];
}

export interface Family {
  id: "explore" | "agents" | "review" | "git";
  title: string;
  href: string;
  /** The loop step this family owns on the homepage. */
  step: "Understand" | "Ask" | "Improve" | "Keep";
  /** Homepage outcome copy: what work this family finishes. */
  outcome: string;
  /** Detail-page lede. */
  summary: string;
  groups: CapabilityGroup[];
  docs: NavLink[];
  workflows: string[];
}

export const families: Family[] = [
  {
    id: "explore",
    title: "Explore knowledge",
    href: routes.explore,
    step: "Understand",
    outcome:
      "Open a bundle in a real reader, switch among graph, treemap, sunburst, and circle-packing views, search by structure, and trace lineage across hops.",
    summary:
      "Open any conformant OKF bundle in a distraction-free reader. Switch among graph views, search by text and structure, preview links, and trace dependencies across hops.",
    groups: [
      {
        title: "A real reader",
        lede: "Concepts open as readable documents.",
        items: [
          {
            title: "The whole extended Markdown set",
            body: "Highlighted code, content-sized tables, math, Mermaid diagrams, footnotes, task lists, emoji, and contained embedded HTML. Plus zoomable images and keyboard-first navigation.",
          },
          {
            title: "Peek before you open",
            body: "Hover any concept link for an instant preview of its type, title, and first lines, before deciding it's worth a tab.",
          },
          {
            title: "Tabs and windows",
            body: "Ctrl+click opens a concept in a new tab with its own history. Drag to reorder, or tear one off into its own window for a second monitor.",
          },
        ],
      },
      {
        title: "Built for the deep dive",
        lede: "Orientation first, then precise questions.",
        items: [
          {
            title: "A home for active work",
            body: "Resume concepts, read the bundle-authored activity stream, handle validation and link issues, and return to current Git changes without hunting through separate panels.",
          },
          {
            title: "Faceted search",
            body: "Queries like type:Table degree>5 combine text, concept type, and graph structure.",
          },
          {
            title: "Lineage across hops",
            body: "Trace upstream dependencies or downstream impact across several hops. Filter by portable or team-defined relationship and reliability state, see cycles and limits, and open a shortest path that explains every step.",
          },
          {
            title: "Meaning on portable links",
            body: "Optional team profiles can label a Markdown link as evidence, dependency, ownership, supersession, or a producer-defined relation. The reader shows known and unknown types without changing OKF validation.",
          },
          {
            title: "Know when knowledge needs caution",
            body: "Optional lifecycle, confidence, effective-time, review, contradiction, and replacement signals qualify what readers and agents see. Missing metadata never makes a concept invalid.",
          },
          {
            title: "Follow a claim to its source",
            body: "Optional evidence markers connect a sentence to a durable source record. The reader shows its locator, observation, adapter, digest, and status, and checks a public source only when you press Check source.",
          },
        ],
      },
      {
        title: "Any conformant bundle",
        lede: "Studio reads bundles from any producer, and a sloppy one still opens.",
        items: [
          {
            title: "Local folder or GitHub URL",
            body: "Open a folder on disk, or explicitly download and cache a GitHub URL on your machine. Studio records that choice and confines readers, assets, watchers, and agents to the bundle roots its scan found.",
          },
          {
            title: "One visible ignore boundary",
            body: "A root .okfignore keeps chosen paths out of parsing, watching, retrieval, source intake, and projections. Studio reports what it excluded and makes clear that ignore rules are not encryption or access control.",
          },
          {
            title: "Bundle details stay together",
            body: "An Info action beside Share shows bundle conformance at a glance, then opens identity, format, metadata, connections, ignore rules, and local profiles in focused views. Connection work opens in its own workspace, while the footer stays quiet.",
          },
          {
            title: "Design-system aware",
            body: "ODSF bundles render their design tokens and live HTML/CSS examples right in the reader.",
          },
          {
            title: "Connections where you use them",
            body: "Resolve external bundles and exchange portable JSON-LD relationships in a dedicated workspace. Language switching and digest-checked resources stay with the active concept. The full report loads only when one of those surfaces needs it.",
          },
        ],
      },
    ],
    docs: [
      { label: "Concept reader", href: doc("features/concept-reader.md"), external: true },
      { label: "Graph view", href: doc("features/graph-view.md"), external: true },
      { label: "Search and filter", href: doc("features/search-and-filter.md"), external: true },
      { label: "Lineage", href: doc("features/lineage.md"), external: true },
      { label: "Evidence and provenance", href: doc("features/evidence-and-provenance.md"), external: true },
      { label: "Ignore rules", href: doc("features/ignore-rules.md"), external: true },
      { label: "Visualization views", href: doc("features/viz-views.md"), external: true },
      { label: "Bundle Connections", href: doc("features/interoperability-lab.md"), external: true },
    ],
    workflows: ["understand", "ask"],
  },
  {
    id: "agents",
    title: "Work with agents",
    href: routes.agents,
    step: "Ask",
    outcome:
      "Ask the agent you choose, right beside the graph and reader. Context goes in explicitly, and every answer keeps an inspectable evidence receipt.",
    summary:
      "Chat with Claude, Codex, Cursor, or a local model in the same workspace as the graph and reader. You decide which agent runs, what context it sees, and what evidence backs its answers. Nothing is written without your review.",
    groups: [
      {
        title: "Choose your agent",
        lede: "The agent account, login, and billing stay with the provider you picked.",
        items: [
          {
            title: "Bring the agent you already use",
            body: "Install Claude Agent, Codex, Cursor, Gemini CLI, GitHub Copilot, Qwen Code, Cline, Auggie CLI, or Factory Droid from a searchable registry. Every build is pinned and checksum-verified.",
          },
          {
            title: "Or keep it fully local",
            body: "Run Studio Agent against Ollama, LM Studio, llama.cpp, or any OpenAI-compatible endpoint. API keys live in your operating system's credential store, never in the app.",
          },
          {
            title: "Threads that come back",
            body: "Run parallel threads per agent and switch by keyboard. Reopen Studio and it reconnects the last agent, resuming its bundle-scoped transcript after agent-owned sign-in.",
          },
        ],
      },
      {
        title: "Ask with evidence",
        lede: "Answers stay readable; the receipts stay inspectable.",
        items: [
          {
            title: "OKF methods built in",
            body: "Studio ships a versioned capability pack of twelve focused methods, including retrieval, authoring, and meaning-preserving revision. Named tasks and ordinary chat select from the same catalog, and Settings shows the exact methods, tools, writing rules, schemas, and digests.",
          },
          {
            title: "Evidence you can inspect",
            body: "Each bundle question runs a local structural search before it reaches the agent. The answer stays readable while a compact receipt keeps excerpts, source conflicts, and missing chronology behind Inspect.",
          },
          {
            title: "Context on your terms",
            body: "Inspect a task's capabilities, tools, concept neighborhood, validation state, sources, and context budget before the first prompt. Remove optional context yourself, and refresh it when a bundle changes.",
          },
          {
            title: "Sources with receipts",
            body: "Files, folders, images, and public pages show their adapter, observed time, origin, fingerprints, and warnings before send. A damaged PDF text layer or page after page of repeated boilerplate is measured and warned about, not passed through silently. Named tasks carry a profile-ready provenance record, while absolute local paths and embedded instructions stay out.",
          },
        ],
      },
      {
        title: "Work from the object in view",
        lede: "Structured work starts where you already are.",
        items: [
          {
            title: "One launcher, any starting point",
            body: "Open authoring, audit, repair, research, enrichment, migration, or change-impact work from the object in view. Profile findings carry the selected local conventions and say which fields OKF requires, which the profile requires, and which it only recommends.",
          },
          {
            title: "Plan intake from a pile of documents",
            body: "Pick PDFs and other documents and Studio computes a plan locally, with no agent involved: proposed concepts split at headings, repeated page furniture set aside with its reason, footnote sources listed unverified, unreadable figures named as gaps, and overlap between sources shown from both sides. Keep or drop each concept, save the plan, rerun it later to see exactly which concepts a changed document feeds, and start the thread when it looks right.",
          },
          {
            title: "Plans and reports that stay usable",
            body: "Bundle plans, source inventories, health reports, research briefs, impact maps, and staged revisions open as validated work beside the conversation, with every bundle write behind staging and review.",
          },
          {
            title: "Hand work to Studio safely",
            body: "Open a bundle, concept, or named OKF task from an installed Studio link or desktop command. Studio previews the decoded request and asks before granting a new folder. Other local agents can receive a one-shot read-only OKF MCP descriptor from Settings.",
          },
        ],
      },
      {
        title: "Stay in control",
        lede: "Every thread shows its scope; nothing happens without you.",
        items: [
          {
            title: "One turn, fully visible",
            body: "Each prompt and its ordered agent work read as one turn. Completed details fold away, active work stays visible, and every thread keeps its visible file, network, credential, and process scope.",
          },
          {
            title: "Memory you can inspect and delete",
            body: "Studio remembers a task-specific context choice only after showing its exact effect, keeps bounded metadata outside the bundle, and lists its owner, origin, retention, and delete action in Settings.",
          },
          {
            title: "Routine checks that fail closed",
            body: "Run or schedule offline bundle-health and source-fingerprint checks without an agent. Routines recheck the bundle grant every time, record interrupted work instead of assuming success, and cannot fetch, prompt, stage, or apply changes.",
          },
        ],
      },
    ],
    docs: [
      { label: "Agent workspace", href: doc("features/agent-panel.md"), external: true },
      { label: "Capability packs", href: doc("features/capability-packs.md"), external: true },
      { label: "Retrieval intelligence", href: doc("features/retrieval-intelligence.md"), external: true },
      { label: "Source adapters", href: doc("features/source-adapters.md"), external: true },
      { label: "Evidence and provenance", href: doc("features/evidence-and-provenance.md"), external: true },
      { label: "Workspace memory", href: doc("features/workspace-memory.md"), external: true },
    ],
    workflows: ["ask", "improve"],
  },
  {
    id: "review",
    title: "Review and improve",
    href: routes.review,
    step: "Improve",
    outcome:
      "Create knowledge from zero or improve what exists. Writing is checked, changes land in a staged tree, and you review every diff before it touches a file.",
    summary:
      "Knowledge changes go through the same gate no matter who wrote them. Studio checks writing deterministically, stages every proposed change, and lets you review, validate, and apply in one restorable transaction.",
    groups: [
      {
        title: "Create and write",
        lede: "From an empty folder to a checked concept.",
        items: [
          {
            title: "Start from zero",
            body: "No bundle yet? A short form creates one: name it, name its first concept, pick a folder. Studio writes a conformant OKF starter, checks it against the spec, and opens it. No agent involved.",
          },
          {
            title: "Writing that keeps the knowledge",
            body: "Name the reader's question, then write a concept or improve an existing one with the same versioned method across agents. A style-only rewrite that drops a number, a qualifier, a citation, a link, a formula, or a code block is rejected before you ever see it.",
          },
          {
            title: "Move a concept without breaking the graph",
            body: "Choose a new Markdown path from the reader. Studio previews every link and index repair, keeps a portable redirect at the old path, validates the isolated result, and applies the reviewed files in one restorable transaction.",
          },
          {
            title: "Retire knowledge without losing the reason",
            body: "Choose deprecate, redirect, tombstone, or delete. Studio shows what happens to links, indexes, and retrieval, records the reason in the bundle log, and keeps deletion behind review, validation, and a restore checkpoint.",
          },
        ],
      },
      {
        title: "Check",
        lede: "Deterministic checks first, advisory judgment second.",
        items: [
          {
            title: "Conformance and portability",
            body: "The Compatibility Clinic and profile checks keep OKF errors separate from optional portability and team advice. Safe link replacements and profile migrations require hunk review and validation before Apply, while the tolerant reader still opens the bundle.",
          },
          {
            title: "Health findings with evidence",
            body: "Audit conformance, graph connectivity, navigation, provenance, freshness, duplication, coverage, and writing patterns with deterministic local checks, no agent involved. A missing claim source names the exact line, and a page that changed or went offline is reported as that, never as a verdict on whether the claim is true.",
          },
          {
            title: "Handling labels without false authority",
            body: "Optional audience, sensitivity, and handling notes stay visible while you read, choose agent context, and review staged files. Studio never treats a metadata label as filesystem permission or silently drops evidence because of it.",
          },
          {
            title: "Create a shareable bundle",
            body: "Name who the copy is for, choose the knowledge to share, then review what will travel and what will stay behind. Optional safeguards can filter handling labels or remove exact text. Studio checks the separate bundle for declared leaks and never edits the source.",
          },
          {
            title: "A second pass without write authority",
            body: "Studio checks each structured result deterministically first. Studio Agent can then review the work for evidence gaps or clarity in a separate no-tool session. A critic can never approve or apply a change.",
          },
        ],
      },
      {
        title: "Review every change",
        lede: "Nothing reaches your files unreviewed.",
        items: [
          {
            title: "Writes you review, always",
            body: "Proposed changes land in a staged tree first. Review each diff hunk, validate against the OKF spec, then apply in one transaction you can restore. Even a verified offline agent that stages unattended still cannot apply changes.",
          },
          {
            title: "Claim-by-claim review",
            body: "A writing revision shows each claim before and after, so a meaning change cannot hide inside a style change.",
          },
        ],
      },
    ],
    docs: [
      { label: "Compatibility Clinic", href: doc("features/compatibility-clinic.md"), external: true },
      { label: "Validation", href: doc("features/validation.md"), external: true },
      { label: "OKF writing", href: doc("features/okf-writing.md"), external: true },
      { label: "Retirement workflow", href: doc("features/retirement-workflow.md"), external: true },
      { label: "Knowledge health", href: doc("features/knowledge-health.md"), external: true },
      { label: "Access hints", href: doc("features/access-hints.md"), external: true },
      { label: "Recipient projections", href: doc("features/recipient-projections.md"), external: true },
      { label: "Erasure audit", href: doc("features/erasure-audit.md"), external: true },
      { label: "Structured agent work", href: doc("features/structured-agent-work.md"), external: true },
      { label: "Create a bundle", href: doc("features/create-bundle.md"), external: true },
    ],
    workflows: ["improve", "ship"],
  },
  {
    id: "git",
    title: "Version with Git",
    href: routes.git,
    step: "Keep",
    outcome:
      "Keep the result: commit reviewed changes into Git history without leaving the workspace, and run remote operations only when you ask.",
    summary:
      "Finish knowledge work without losing its context. Studio puts the repository beside the bundle: review changes, choose what enters the index, commit, inspect history, and reach for remotes explicitly. It is not a general-purpose Git client, by design.",
    groups: [
      {
        title: "The repository beside the bundle",
        lede: "Enough Git to finish the work you just reviewed.",
        items: [
          {
            title: "Review and stage",
            body: "Review repository changes in the workspace and choose exactly what enters the index.",
          },
          {
            title: "Commit and history",
            body: "Commit staged or tracked files and inspect recent history without switching apps.",
          },
          {
            title: "Remotes stay explicit",
            body: "Fetch, fast-forward pull, or push happen only when you trigger them. Studio never runs a remote operation on its own.",
          },
          {
            title: "Scope you confirm",
            body: "A bundle inside a repository subfolder gets a one-time native repository confirmation before Studio touches the repo at all.",
          },
        ],
      },
    ],
    docs: [
      { label: "Integrated Git", href: doc("features/integrated-git.md"), external: true },
      { label: "Git workflow", href: doc("ux/git-workflow.md"), external: true },
    ],
    workflows: ["ship"],
  },
];

export const familyById = Object.fromEntries(families.map((f) => [f.id, f])) as Record<
  Family["id"],
  Family
>;

/** Visualization proof assets owned by the explore family. */
export interface VizView {
  src: string;
  title: string;
  body: string;
  alt: string;
}

const base = import.meta.env.BASE_URL;

export const vizzes: VizView[] = [
  {
    src: `${base}screenshot-viz-graph.webp`,
    title: "Graph",
    body: "The force-directed network: what cites what, hubs and clusters at a glance. Double-click a node to expand its neighborhood.",
    alt: "OKF Studio's force-directed graph of a documentation bundle, nodes colored by concept type",
  },
  {
    src: `${base}screenshot-viz-treemap.webp`,
    title: "Treemap",
    body: "Nested rectangles sized by how much is written: what's big, what's inside what. Click a group to drill in.",
    alt: "OKF Studio's treemap view: nested rectangles grouped by section, sized by content",
  },
  {
    src: `${base}screenshot-viz-sunburst.webp`,
    title: "Sunburst",
    body: "Every ring adds an authored level, and All keeps every concept in view. Click a sector to focus; the center takes you back up.",
    alt: "OKF Studio's sunburst view with authored bundle sections as concentric rings",
  },
  {
    src: `${base}screenshot-viz-pack.webp`,
    title: "Circle packing",
    body: "Groups within groups as nested circles, with a smooth zoom as you drill down and out.",
    alt: "OKF Studio's circle-packing view: concepts as nested circles grouped by section",
  },
];
