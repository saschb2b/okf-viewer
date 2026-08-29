---
type: Reference
title: Document Intake Research
description: Demand signals, ecosystem extraction and review practice, and a two-PDF dogfood that together shape a corpus-to-bundle intake feature.
tags: [reference, intake, sources, extraction, provenance, review, research]
generated: { by: claude/fable-5, at: 2026-08-29T17:40:00+02:00 }
sources:
  - resource: "https://docling-project.github.io/docling/concepts/docling_document/"
    title: "DoclingDocument: unified document representation"
  - resource: "https://github.com/aws-solutions-library-samples/accelerated-intelligent-document-processing-on-aws/blob/main/docs/human-review.md"
    title: "AWS accelerated IDP: human review design"
  - resource: "https://www.firecrawl.dev/blog/best-pdf-parsers"
    title: "Best PDF parsers for AI and RAG workflows in 2026"
  - resource: "https://unstract.com/blog/human-in-the-loop-hitl-for-ai-document-processing/"
    title: "Human in the loop for AI document processing"
  - resource: "https://www.sciencedirect.com/science/article/pii/S2667305326000499"
    title: "Multi-source knowledge graph construction through LLM-assisted incremental fusion"
  - resource: "https://drops.dagstuhl.de/storage/08tgdk/tgdk-vol003/tgdk-vol003-issue001/TGDK.3.1.3/TGDK.3.1.3.pdf"
    title: "Uncertainty management in the construction of knowledge graphs: a survey"
  - resource: "https://www.reddit.com/r/documentAutomation/"
    title: "r/documentAutomation demand-signal review"
---

# Research question

Studio's loop begins where an OKF bundle already exists. The demand adjacent to that loop begins earlier, at a pile of documents that is not knowledge yet. This research asks three questions. What do people building and buying document automation say they need. What does the extraction and review ecosystem already treat as settled practice. And what does Studio's current attachment path actually produce when pointed at two real research PDFs. All web sources were retrieved on 2026-08-29.

# Demand signals

A review of r/documentAutomation (retrieved 2026-08-29) is thin evidence on its own: a small community whose showcase posts sit near zero engagement. The threads where people engaged rather than promoted repeat five needs:

- **Review before trust.** Two builders publicly asked whether to prioritize an API or "proper validation + review workflows", and how approval should work "before a doc is considered usable". The review boundary is the openly named unsolved part of that market, and it is the part Studio has already built.
- **Large-corpus navigation.** The highest-engagement question asked which industries depend on huge PDF manuals and SOPs, and where workers struggle to find anything in them.
- **Restructuring existing corpora.** A representative request: reformat a 700-page policy document into a new fixed-section schema, merging several old policies into one new one.
- **Parser distrust.** Practitioners list the same complaints about extraction services: no contextual understanding of what was extracted, silent skips on unreadable regions, and error handling that forces manual review anyway.
- **Repeatable mappings.** "Teach it once, reuse forever" tools learn a source-to-output mapping opaquely. The ask behind them is a mapping that can be rerun when sources change; the unmet half is a mapping the user can inspect.

These signals justify hypotheses, not commitments. The dogfood below is the evidence this branch actually stands on.

# What extraction practice treats as settled

Layout-aware structural parsing has converged on a document model that a page-numbered text dump cannot represent:

- **Body and furniture are distinct trees.** Docling's document model keeps main content in a `body` tree and running headers, footers, and page decorations in a `furniture` tree, so repeated page chrome is classified by role rather than deleted or duplicated. Reading order flows through the body tree.
- **Every item carries provenance.** Parsed items keep page numbers and bounding boxes, so a downstream consumer can point from any extracted statement back to its exact place on a page.
- **Tables, figures, and headings are typed items,** not undifferentiated text, so a consumer can treat a figure it cannot read as a named gap instead of number soup.

The lesson for Studio is about the contract, not the library: extraction output must be a structural tree with per-item provenance and a furniture classification, whatever produces it.

# What review practice treats as settled

Intelligent-document-processing review interfaces agree on a small set of patterns:

- **Split-pane, source-anchored review.** The source page renders beside the extracted result, with the extracted item's location highlighted, so verifying one claim takes seconds rather than a search.
- **Uncertainty-first ordering.** Review queues rank by confidence and coverage rather than document order. AWS's reference implementation color-codes fields against a threshold (0.8 as the starting recommendation) and offers a filter that shows only low-confidence fields, naming reviewer cognitive load as the design constraint.
- **Typed review triggers.** Review is triggered by below-threshold confidence, by conflicting extractions, by a coverage floor (too many empty fields), or by a novel document shape. "Review everything" is treated as a failure mode.

Studio's existing hunk review, isolated validation, and atomic Apply already exceed this market's write discipline. What intake needs from this literature is the reading half: anchor every proposed claim to its source location and rank review by uncertainty.

# What multi-source construction treats as settled

Knowledge-graph construction research is blunt about corpora that overlap:

- **Conflicts are surfaced, not averaged.** When two sources disagree on a value, mature systems retain both positions with their provenance and effective dates rather than resolving silently. Confidence and provenance travel as metadata on the claim.
- **A knowledge page is never a source.** The Wikidata discipline: every statement remains traceable to an external source, and the derived page cannot cite itself.
- **Fusion timing is a design choice.** Early fusion merges during construction, late fusion keeps sources independent until query time. For a reviewed workspace the useful hybrid is late-by-default: keep per-source claims distinct, and let a reviewed decision produce the merged statement.

Studio already owns the vocabulary this needs: [reliability and lifecycle](../features/reliability-and-lifecycle.md) defines contradiction and effective-time signals, and [evidence and provenance](../features/evidence-and-provenance.md) defines the claim-to-source record.

# Dogfood: two real Cardano PDFs, 2026-08-29

Two publicly circulated research documents about the same subject were run through a layout-preserving text extraction equivalent to the current bounded helper's output class, to measure what Studio's attachment path hands an agent today.

**Document A** is Grayscale's "An Introduction to Cardano" (September 2021, 21 pages, 2.0 MiB). Its structure is exactly what the demand signals describe: a table of contents, seven prose sections, 13 numbered figures, 12 numbered footnotes carrying source URLs and observation dates, a one-line legal footer on every page, and a legal-disclosure tail. Measured against the extraction:

- The footer line repeats 21 times, once per page, interleaved with body prose.
- A page-margin number rail (1 through 7) interleaves the prose on most pages as stray single-digit lines.
- All 13 figures collapse to a caption plus disordered axis labels. The chart data itself is unrecoverable from the text layer, and nothing marks the loss.
- The disclosure tail is 19.7 of 66.5 extracted kilobytes. Roughly 30 percent of what an agent would read is legal boilerplate.
- Footnote lines sit orphaned at page bottoms. The claim each one supports is on the same page, but nothing connects them, even though the footnotes carry precisely the source URL and observation date that an evidence record wants.
- Its license forbids reproduction, so document A can inform fixture design but cannot enter the repository. Its shapes must be reproduced synthetically.

**Document B** is IOHK's "Why We Are Building Cardano" (June 2017, 44 pages, CC-BY 4.0). It adds two shapes document A lacks:

- **Extraction damage.** The text layer carries glyph-spacing corruption ("B UILDING", "H OSKINSON"). The damaged running header alone occurs 51 times. A pipeline without quality diagnostics would propagate this into every derived concept.
- **Fixture eligibility.** CC-BY 4.0 permits reduced excerpts as checked-in fixtures with attribution, which makes document B the natural seed of an intake test corpus.

**Cross-source findings.** The two documents overlap on founding, consensus design, and roadmap while differing in date, producer class, and register (2017 design intent versus 2021 measured state). Document A names the co-founder "Jerry Wood" where the project's own record gives Jeremy Wood: a real factual error in a professionally produced source. An intake that merges sources silently launders that error into a concept; an intake that keeps per-source claims and surfaces disagreement makes it reviewable. Freshness disagreements (figures with observation dates against undated design claims) map directly onto the effective-time vocabulary that [reliability and lifecycle](../features/reliability-and-lifecycle.md) already defines.

# Implications

1. Per-page text dumps are the wrong evidence contract for document corpora. Extraction must classify furniture, keep a heading tree, bind footnotes to pages, and mark figure losses as named gaps.
2. Extraction quality must be diagnosed, not assumed: repeated-furniture detection, glyph-spacing damage detection, and empty-region accounting belong in the receipt with stable codes.
3. The mapping from sources to proposed concepts must itself be an inspectable, re-runnable object, not a transcript side effect. Refresh identity already exists on [adapter receipts](../features/source-adapters.md).
4. Multi-source intake keeps claims per-source and renders overlap and contradiction as review material, using the existing reliability vocabulary rather than a new one.
5. Review is source-anchored and uncertainty-first. The staging, validation, and Apply boundary is already sufficient; intake feeds it better-shaped proposals.

The feature these implications shape is [Document Intake](../features/document-intake.md); the sequencing lives in the [Document Intake roadmap](../product/document-intake-roadmap.md).
