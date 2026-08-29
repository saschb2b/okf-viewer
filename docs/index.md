---
okf_version: "0.2"
profiles:
  io.okf.access:
    version: "1.0.0"
    descriptor: "profiles/io.okf.access.json"
  io.okf.evidence:
    version: "1.0.0"
    descriptor: "profiles/io.okf.evidence.json"
  io.okf.reliability:
    version: "1.0.0"
    descriptor: "profiles/io.okf.reliability.json"
  io.okf.interop:
    version: "0.1.0"
    descriptor: "profiles/io.okf.interop.json"
external_bundles:
  google-okf:
    url: "https://github.com/GoogleCloudPlatform/knowledge-catalog"
---

# OKF Studio product knowledge

**OKF Studio** is a cross-platform desktop workspace for connected [Open Knowledge Format](reference/okf-spec-summary.md) (OKF) bundles. It detects bundles in a folder, renders each as a graph and reader, and gives user-chosen agents explicit context for creation, curation, and cited research. Proposed writes remain staged until the user validates, reviews, and applies them. The app uses [Tauri 2.0](reference/tauri-2.md), with a Rust core and the system webview.

This bundle is the product source of truth and the app's built-in sample. Start with [Product](product/) for purpose and boundaries, [Features](features/) for behavior, [UX](ux/) for interaction contracts, or [Architecture](architecture/) for implementation decisions.

# Product

* [Overview](product/overview.md) - A local-first workspace for exploring, creating, curating, and querying connected OKF bundles with user-chosen agents.
* [OKF Studio Transformation](product/studio-roadmap.md) - Sequenced work packages for creation, curation, querying, reviewed writes, and external-agent isolation.
* [OKF Agent Specialization](product/agent-specialization-roadmap.md) - Sequenced work packages for specialized OKF skills, artifacts, routines, and entry points.
* [OKF Writing Quality](product/okf-writing-quality-roadmap.md) - Sequenced work for evidence-preserving authoring, prose revision, advisory diagnostics, and measurable provider quality.
* [Agent Harness Evolution](product/agent-harness-roadmap.md) - Sequenced work for deterministic decomposition, budgeted parallel runs, and measured orchestration efficiency.
* [OKF Retrieval Intelligence](product/retrieval-intelligence/retrieval-intelligence-roadmap.md) - The next research branch for routed retrieval, coherent context, diagnostics, and reviewed corpus repair.
* [Integrated Git Support](product/git-integration/git-integration-roadmap.md) - Sequenced work for repository status, staging, commits, history, and explicit remote operations.
* [OKF Ecosystem Response](product/okf-ecosystem-response-roadmap.md) - Value-led work packages for compatibility, profiles, living knowledge, provenance, projections, and interoperability experiments.
* [Document Intake Evolution](product/document-intake-roadmap.md) - Sequenced work packages for structural extraction, the inspectable intake plan, and multi-source contradiction handling.
* [Zed Git Research](product/git-integration/zed-git-research.md) - The source-level architecture and UX findings used for Studio's Git direction.
* [Site Experience Research](product/site-evolution/site-experience-research.md) - Evidence behind replacing the one-page feature catalogue with a scalable product site.
* [Site Experience Contract](product/site-evolution/site-experience-contract.md) - Target site map, navigation, homepage story, content ownership, and implementation sequence.
* [OKF Viewer to OKF Studio](product/migration-notes.md) - How existing local data, credentials, and compatibility identifiers behave on upgrade.
* [Personas and Use Cases](product/personas.md) - Who it's for, as concrete personas and the jobs they hire it to do.
* [How It Compares](product/comparison.md) - OKF Studio vs. the reference visualizer, PKM tools, static-site generators, editors, and agent chat surfaces.
* [Design Principles](product/principles.md) - The non-negotiables: local-first, vendor-neutral, tolerant, read-only by default, and visible agency.
* [Scope and Non-Goals](product/scope-and-non-goals.md) - Current Studio scope, deferred work, and explicit non-goals.

# Features

* [Agent Panel](features/agent-panel.md) - Run parallel agent threads, attach OKF context, approve tools, and review proposed knowledge changes.
* [Source Adapters and Provenance](features/source-adapters.md) - Turn selected files, folders, images, and public URLs into bounded untrusted evidence with visible versioned provenance.
* [Document Intake](features/document-intake.md) - Turn selected documents into a staged, source-anchored bundle proposal through an inspectable, re-runnable plan.
* [Evidence and Provenance](features/evidence-and-provenance.md) - Keep durable source identity with a concept, connect claims to evidence, and check public sources only after an explicit action.
* [Folder Autodetect](features/folder-autodetect.md) - Point at a folder and find every OKF bundle inside it.
* [Ignore Rules](features/ignore-rules.md) - Keep selected paths out of Studio through one visible root rule file without mistaking it for access control.
* [Access Hints](features/access-hints.md) - Show audience, sensitivity, and handling guidance without treating metadata as authorization.
* [Recipient Projections](features/recipient-projections.md) - Choose knowledge, review what will travel, and save a separate shareable bundle.
* [Erasure Audit](features/erasure-audit.md) - Block a projection when declared excluded material remains in its generated output.
* [Bundle Connections](features/interoperability-lab.md) - Resolve external knowledge, exchange relationships, and use optional language and resource conventions where each task belongs.
* [Bundle Switcher](features/bundle-switcher.md) - Top-left switcher for the open bundle, sibling bundles in the folder, and recently-opened bundles.
* [Bundle Home](features/bundle-home.md) - Resume active concepts, review authored activity, handle deterministic attention items, and return to repository work.
* [Graph View](features/graph-view.md) - Force-directed graph of concepts, colored by type, linked by cross-references.
* [Visualization Views](features/viz-views.md) - Treemap, sunburst, and circle packing views of the bundle hierarchy.
* [Concept Reader](features/concept-reader.md) - Rendered markdown with frontmatter, citations, and clickable links.
* [Reliability and Lifecycle](features/reliability-and-lifecycle.md) - Qualify optional lifecycle, confidence, review, contradiction, and replacement signals without changing OKF conformance.
* [Design-System Rendering](features/design-system-rendering.md) - Native ODSF token visualizations and sandboxed example previews.
* [Search and Filter](features/search-and-filter.md) - Full-text search, type filters, and tag browsing.
* [Navigation](features/navigation.md) - Progressive disclosure from index.md, link following, and history.
* [Command Palette](features/command-palette.md) - Jump to any concept and run quick actions from the keyboard.
* [Validation](features/validation.md) - Surface OKF conformance errors and warnings without refusing the bundle.
* [Knowledge Health](features/knowledge-health.md) - Give agents deterministic quality evidence without turning heuristics into conformance.
* [OKF Writing](features/okf-writing.md) - Author and revise concepts around a reader job while preserving claims and references.
* [Structured Agent Work](features/structured-agent-work.md) - Keep validated OKF plans, reports, research, migrations, and staged revisions active beside the conversation.
* [Artifact Verification and Critic Passes](features/artifact-verification.md) - Compare deterministic checks with an optional isolated critic whose findings cannot approve or apply work.
* [Inspectable Workspace Memory](features/workspace-memory.md) - Apply only current, bundle-scoped local preferences to context plans and keep every item inspectable and deletable.
* [Local OKF Routines and Attention Inbox](features/local-routines.md) - Schedule deterministic offline maintenance with a Rust-owned recovery ledger and visible attention results.
* [Guarded External Entry Points](features/external-entry-points.md) - Review deep-link and CLI handoffs and issue one-shot read-only MCP grants without silently starting an agent.
* [Declarative OKF Capability Packs](features/capability-packs.md) - Inspect and reversibly activate the digest-bound skills, templates, artifact schema, and tool contract Studio gives agents.
* [Native OKF Tasks](features/native-okf-tasks.md) - Start bounded curated work from the OKF object already in view.
* [Live Reload](features/live-reload.md) - Watch the folder and refresh the graph as files change.
* [Log View](features/log-view.md) - Render a bundle's log.md as a dated, newest-first change timeline.

# UX

* [First Run](ux/first-run.md) - From empty state to a rendered bundle in two clicks.
* [Empty and Error States](ux/empty-and-error-states.md) - Every no-content, loading, and failure state, and how to recover.
* [Agent Workspace Dogfood](ux/agent-workspace-dogfood.md) - Journey evidence and open findings from the Agent Panel workspace refinement.
* [Browsing Layout](ux/browsing-layout.md) - The three-pane workspace: sidebar, graph, reader.
* [Keyboard Shortcuts](ux/keyboard-shortcuts.md) - Keys for power users.
* [Theming](ux/theming.md) - Light/dark, the surface and state token layer, and the type-color palette.
* [Accessibility](ux/accessibility.md) - Keyboard operability, focus, screen-reader semantics, contrast, and motion.
* [Settings and preferences](ux/settings.md) - Searchable categories for local, reader, agent, bundle, and update controls.

# Architecture

* [Agent System](architecture/agent-system.md) - External ACP agents, Studio Agent, credentials, scoped tools, permissions, and reviewed writes.
* [Agent Orchestration](architecture/agent-orchestration.md) - Delegated runs over Rust-computed context slices, one writer, declared budgets, and the protocol limit on governing external subagents.
* [Tech Stack](architecture/tech-stack.md) - Tauri 2.0, the Rust core, the frontend, and why.
* [Bundle Detection](architecture/bundle-detection.md) - The algorithm that finds OKF bundles in a folder.
* [OKF Parsing](architecture/okf-parsing.md) - How Studio parses concepts, links, and indexes.
* [Data Model](architecture/data-model.md) - Bundle, Concept, and Graph shapes shared across the IPC boundary.
* [Frontend Architecture](architecture/frontend-architecture.md) - The frontend as a thin client over the Rust command/event surface.
* [IPC and Security](architecture/ipc-and-security.md) - Typed Tauri commands for scoped reads, explicit network and process actions, and reviewed writes.
* [Performance and Scale](architecture/performance.md) - How the app stays fast, from the bounded scan to graph rendering.
* [Testing and Dogfooding](architecture/testing.md) - Frontend, Rust core, native host, accessibility, conformance, and Studio authoring gates.
* [OKF Agent Benchmarking](architecture/agent-benchmarking.md) - Frozen task fixtures, machine-checked OKF facts, and provider evaluation boundaries.
* [Build and Release](architecture/build-and-release.md) - Versioning, per-OS packaging, releases on two of three platforms, and opt-in updates.

# Reference

* [Zed Agent System Research](reference/zed-agent-system.md) - Primary-source patterns and constraints adopted for OKF Studio.
* [Agent Harness Research](reference/agent-harness-research.md) - What control surfaces such as T3 Code actually implement, what the multi-agent literature settles, and what ACP cannot expose.
* [Specialized Agent Systems Research](reference/specialized-agent-systems.md) - Product patterns for turning the agent foundation into an OKF-specialized workspace.
* [Document Intake Research](reference/document-intake-research.md) - Demand signals, extraction and review practice, and the two-PDF dogfood behind document intake.
* [OKF Spec Summary](reference/okf-spec-summary.md) - The v0.1 rules Studio must honor.
* [OKF Reference HTML Visualizer](reference/okf-reference-visualizer.md) - Google's single-file HTML consumer, the reference this app is the desktop counterpart to.
* [OKF Sample Bundles](reference/okf-sample-bundles.md) - The GA4, Stack Overflow, and Bitcoin bundles used as additional fixtures.
* [Multilingual Variants Experiment](reference/multilingual-variants-experiment.md) - Compare language conventions without selecting a core format.
* [External Bundle References Experiment](reference/external-bundle-references-experiment.md) - Test explicit read-only resolution with namespaced identity.
* [Semantic-Web Exchange Experiment](reference/semantic-web-exchange-experiment.md) - Round-trip a declared JSON-LD relationship subset with loss accounting.
* [Sidecar Resources Experiment](reference/sidecar-resources-experiment.md) - Inventory and export digest-checked companion files without execution.
* [Tauri 2.0](reference/tauri-2.md) - Key facts about the framework and its plugins.
* [Glossary](reference/glossary.md) - Terms used across this bundle.

# Proposals

* [Deep Knowledge Diving](proposals/deep-knowledge-diving.md) - Where the viewer is thin for going deep, and the big-data patterns worth borrowing.
* [Bundle Overview and Health (superseded)](proposals/bundle-overview.md) - The original inventory-dashboard proposal, superseded by a working Home for activity, resumption, attention, and repository changes.
* [Faceted Query Bar](proposals/faceted-search.md) - Structured field queries and facet rails that filter the workspace live.
* [Lineage and Traversal](proposals/lineage-and-traversal.md) - Expand-on-click, upstream/downstream lineage, path-between, and unlinked mentions.
* [Multi-View: Tabs and Windows](proposals/multi-view.md) - Reader tabs with per-tab history, browser-standard modifier clicks, and undocking a tab into its own window.

# Subdirectories

* [Product](product/) - Vision, audience, principles, and scope.
* [Features](features/) - One concept per user-facing capability.
* [UX](ux/) - Flows, layout, shortcuts, theming, accessibility, settings.
* [Architecture](architecture/) - Implementation decisions.
* [Reference](reference/) - External specs, the OKF ecosystem, and a glossary.
* [Proposals](proposals/) - Design directions not yet built.
