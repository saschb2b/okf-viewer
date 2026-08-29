---
type: Feature
title: Source Adapters and Provenance
description: Versioned Rust adapters turn selected files, folders, images, and public URLs into bounded untrusted evidence with visible provenance and refresh identity.
tags: [feature, agents, sources, adapters, provenance, security]
generated: { by: claude/unrecorded, at: 2026-07-23T18:30:00Z }
---

# Purpose

Source intake is a producer workflow, not a generic file-reading capability. The user selects a file, folder, image, or public HTTPS URL. Rust discovers and reads only that selection, chooses a closed adapter, and returns normalized evidence plus a versioned receipt. The [Agent Panel](agent-panel.md) shows the receipt before the user sends a prompt or asks an agent to propose concepts.

# Why this exists

Raw attachments give an agent bytes. They do not establish how Studio read those bytes, whether a refresh is equivalent, or which exact evidence supported the resulting concepts. Different formats also encourage one-off parsing in prompts, where malformed input, hidden instructions, and unstable ordering are difficult for the user to inspect.

Adapters turn each explicit selection into repeatable evidence with visible origin, normalization, warnings, and fingerprints. The receipt lets Studio reject a forged or stale interpretation and lets the user compare later refreshes. Domain adapters preserve useful structure for OpenAPI, dbt, and BigQuery exports without granting a general filesystem reader or live cloud account.

# Adapter contract

Every adapter receipt uses schema version 1 and records:

- adapter ID and version
- the UTC time at which Studio observed the selected or fetched bytes
- discovery mode: file, folder, image, or URL
- bounded visible origin and closed media type
- SHA-256 source fingerprint over the original bytes
- SHA-256 evidence fingerprint over the exact normalized content sent to the agent
- refresh fingerprint over the receipt schema, adapter ID, adapter version, and source fingerprint
- the fixed trust label `untrusted`
- bounded warning diagnostics with stable codes and recovery text.

Rust revalidates the receipt at prompt submission. Origin and media type must match the attachment. Source and evidence fingerprints must match the attached bytes or normalized text. The refresh fingerprint must match the declared adapter contract. A webview cannot forge a different adapter, evidence body, or trust label.

The composer keeps the healthy inventory collapsed to one line. A partial extraction opens it so the warning, adapter, origin, evidence ID, and refresh ID are visible. The inventory states that embedded instructions remain inert. The full adapter receipt also precedes the evidence in the agent context block.

When an adapted source enters a named OKF task, Studio also derives the bounded `io.okf.evidence` profile record described in [Evidence and Provenance](evidence-and-provenance.md). The accepted context keeps the observed time, fingerprints, adapter, media type, and safe locator beside the source body. This lets a staged concept retain the exact receipt identity. Absolute local paths, cache locations, and credentials do not enter the projection.

# Built-in adapters

Plain text, Markdown, and HTML keep their bounded UTF-8 content. Studio never inserts HTML into a webview HTML sink. CSV becomes deterministic positional Markdown tables. Generic JSON becomes a deterministic RFC 6901 pointer inventory. PDF extraction stays in the bounded helper process and carries partial-page warnings. It also computes the deterministic structural classification, furniture, headings, footnotes, and figure gaps, that [Document Intake](document-intake.md) builds on, and promotes severe quality findings to receipt warnings.

Images retain verified binary evidence for an image-capable ACP agent. Folder discovery delegates each supported child to the same file adapter while preserving its folder-relative origin. URL discovery uses the existing HTTPS-only, redirect-safe, private-address-blocking fetch boundary.

Studio inspects JSON and OpenAPI YAML before the generic JSON path:

- OpenAPI 2 and 3 documents become a sorted method, path, operation ID, and summary inventory. Missing operation IDs remain visible warnings.
- dbt manifests become a sorted node and source inventory with project, schema version, relation, and dependency counts.
- BigQuery metadata exports become a dataset and table inventory with object type and field counts. Table records without a schema remain usable partial evidence with a recovery warning.

Studio does not accept generic YAML. YAML intake exists only for OpenAPI, so a broad serialization format cannot silently widen the producer contract.

# Determinism and refresh

Equivalent OpenAPI material in JSON and YAML produces the same normalized evidence and evidence fingerprint. Their source and refresh fingerprints differ because their original bytes differ. A later refresh must run the same adapter version against newly selected or fetched bytes and compare both identities. Studio never treats a matching title or origin as proof that the evidence did not change.

Malformed JSON, YAML, CSV, OpenAPI, dbt, and BigQuery exports fail with the source title and a bounded parser or contract reason. Partial but structurally valid material stays available with diagnostics. Adapter output is evidence only. It cannot approve a claim, satisfy a citation by itself, or grant filesystem, network, or write access.

# Deferred connectors

OpenAPI, dbt, and BigQuery support accepts local exports or an already bounded public URL response. Studio does not authenticate to BigQuery, dbt Cloud, source-control hosts, document stores, or other cloud providers. A live connector needs its own credential owner, least-privilege scopes, and pagination and retry policy. It also needs billing and quota behavior, retention, offline behavior, a revocation path, and a product-specific threat model. Studio requires all of that before a connector can enter this adapter surface.

# Related concepts

- [Agent System](../architecture/agent-system.md) owns adapter validation and prompt mediation.
- [Native OKF Tasks](native-okf-tasks.md) starts creation, enrichment, or research from an attached source.
- [Structured Agent Work](structured-agent-work.md) renders source inventories and bundle plans after Rust validates the artifact.
- [OKF Agent Specialization](../product/agent-specialization-roadmap.md) sequences source adapters before routines and capability packs.
