---
type: Feature
title: Document Intake
description: Turn explicitly selected documents into a staged, source-anchored bundle proposal through an inspectable, re-runnable intake plan.
tags: [feature, intake, sources, extraction, provenance, contradiction, review]
generated: { by: claude/fable-5, at: 2026-08-29T19:30:00+02:00 }
sources:
  - resource: ../reference/document-intake-research.md
    title: Document Intake Research
---

# Purpose

Document intake turns a user-selected set of documents into a proposed OKF bundle or enrichment, with every proposed claim anchored to the exact place in a source it came from, through the existing staged review boundary. It is the step upstream of everything Studio does today: [source adapters](source-adapters.md) make one attachment into bounded evidence for one thread, while intake makes a corpus into a reviewable knowledge proposal that outlives the thread.

Nothing about the write side changes. An intake proposal enters the same staging, conformance validation, hunk review, and atomic Apply that every other bundle write uses. What intake adds is the reading half: structural extraction, an inspectable plan, and per-source claims.

# Why this exists

Today a user with a folder of PDFs attaches them one at a time and asks an agent to propose concepts. The [research behind this feature](../reference/document-intake-research.md) measured what that path hands the agent for a real 21-page research PDF: a per-page text dump where a legal footer repeats 21 times, 30 percent of the characters are disclosure boilerplate, 13 figures collapse to unmarked number soup, and footnotes carrying source URLs and observation dates sit orphaned at page bottoms. A second source document added glyph-spacing corruption repeated 51 times and a factual error that a silent merge would launder into the bundle.

The market around this problem has the opposite gap. Extraction and generation tools are plentiful; the openly unsolved part is review before trust, which Studio already has. Intake connects Studio's review boundary to the corpus on-ramp it currently lacks.

# Structural evidence

Intake extends the [adapter contract](source-adapters.md) with a structural layer. Extraction stays deterministic, offline, and inside the bounded helper. For each document it produces, in addition to the existing normalized text:

- **A body and furniture split.** Lines that repeat across pages in stable positions (running headers, footers, page-number rails) are classified as furniture. Furniture is set aside visibly, never silently deleted: the receipt records what was classified and why, and review can reinstate it.
- **A heading tree.** Headings and their nesting, recovered from layout and numbering, give the document a section structure that concept proposals can follow.
- **Footnote binding.** Numbered footnotes are recognized and bound to the page they close. A footnote carrying a URL becomes an evidence candidate with the footnote's own stated observation date, marked unverified until an explicit [source-liveness check](evidence-and-provenance.md) is run.
- **Figure and table gaps.** A region whose content cannot be recovered from the text layer becomes a named gap carrying its caption, page, and kind. A gap is honest missing evidence; intake never invents text for it, and OCR remains out of scope exactly as it is for [attachments](agent-panel.md).
- **Quality diagnostics.** Repeated-furniture share, glyph-spacing damage, empty regions, and truncation are measured and recorded with stable codes in the structural classification. Findings severe enough to impair the evidence, heavy furniture share or repeated intra-word splits, are promoted to the adapter receipt as bounded warnings. A damaged source is usable partial evidence with visible warnings, following the tolerant-consumer stance.

Every structural item keeps a locator: page and line span at minimum. The locator is what lets review anchor a proposed claim to its origin.

# The intake plan

The plan is the feature's first-class object: an inspectable mapping from selected sources to proposed concepts.

- **Deterministic where structure suffices.** Section-to-concept split points, proposed titles, the exclusion list (furniture, boilerplate tails), and the evidence inventory are computed from the structural extraction in Rust, with no model involved, and are byte-identical for identical sources.
- **Agent-assisted where it does not.** Type assignment, descriptions, claim selection, and cross-concept links are proposed by a connected agent working from the structural evidence, under the same context visibility as any thread.
- **Inspectable before anything runs.** The plan renders in its own workspace dialog, reachable from the command palette as **Plan document intake**: which concepts would exist, which source spans feed each one, what is set aside as furniture and why, which footnotes are evidence candidates, and which gaps remain. A user can keep or drop each proposed concept before committing an agent to the work; editing split points is deferred until guided proposals exist to consume them.
- **Saved and re-runnable.** The plan persists beside the bundle with the refresh fingerprint of every source. When a source changes, rerunning the plan names exactly which concepts are fed by changed spans and stages the difference, rather than starting over. The plan is a description of work, never authority: rerunning it requires the same explicit actions as running it.

# Multi-source overlap and contradiction

A corpus about one subject overlaps and disagrees. Intake keeps claims per-source and treats disagreement as output:

- Each proposed concept's claims carry the evidence record of the exact source span behind them, in the [io.okf.evidence](evidence-and-provenance.md) vocabulary.
- When two sources support the same claim, the concept cites both. When they disagree, the conflict surfaces in review as both positions with their sources and observation dates, using the contradiction and effective-time vocabulary from [reliability and lifecycle](reliability-and-lifecycle.md). Nothing is averaged or silently preferred.
- A reviewed decision resolves a conflict into a statement, or keeps it as a recorded contradiction in the bundle. An unresolved contradiction is valid, honest knowledge.

# Review

Intake review follows the settled human-in-the-loop findings from the [research](../reference/document-intake-research.md) without weakening Studio's existing boundary:

- **Source-anchored.** Reviewing a proposed concept shows the source span it derives from beside it, reachable through the claim's locator.
- **Uncertainty-first.** Review orders by diagnostics: contradictions, damaged-extraction regions, gaps, and low-coverage sections come first; clean prose sections come last. Everything remains reviewable; nothing is auto-accepted.
- **The same write path.** Kept hunks proceed through isolated validation, atomic Apply, and restore, identical to every other staged revision.

# Boundaries

- Intake reads only explicitly selected files and folders through the existing grant model. It adds no crawling, no new network path, and no background service.
- No OCR. Image-only regions and figures are named gaps.
- The plan never writes, schedules, or grants. Persistence of a plan is not permission to run it.
- Extraction remains in the bounded helper process with the existing size, page, and timeout limits.
- Document formats arrive one at a time behind the same adapter discipline. PDF is first because its failure shapes are measured; each further format needs its own threat model before it widens the surface.

# Related concepts

- [Source Adapters and Provenance](source-adapters.md) supplies the receipt contract intake extends.
- [Evidence and Provenance](evidence-and-provenance.md) defines the claim-to-source records intake emits.
- [Reliability and Lifecycle](reliability-and-lifecycle.md) supplies the contradiction and effective-time vocabulary.
- [Structured Agent Work](structured-agent-work.md) renders the plan and its runs.
- [Native OKF Tasks](native-okf-tasks.md) is the entry point family intake joins.
- The [Document Intake roadmap](../product/document-intake-roadmap.md) sequences delivery.
