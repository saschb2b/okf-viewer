---
type: Feature
title: Native OKF Tasks
description: Start a bounded, curated OKF task from the concept, finding, citation, graph object, search result, or source already in view.
tags: [feature, agents, tasks, context, launcher, keyboard]
generated: { by: claude/unrecorded, at: 2026-07-23T13:55:00Z }
---

# Purpose

OKF work starts from the object the user already has open. Studio provides the same task launcher from a reader concept, graph selection, validation finding, resource citation, command-palette search result, or attached source. The resulting prompt carries the selected concept IDs or bounded source evidence, so the user does not have to copy a path into chat.

# Why this exists

A generic composer makes the user translate visible workspace state into prompt text. They must name the concept again, decide which neighboring evidence matters, and describe whether they want an audit, repair, or enrichment. That repetition loses object identity, encourages oversized context, and lets similar requests take different capability and tool paths depending on wording.

Native tasks make the selected object the starting point and the task ID the stable expression of intent. Studio can then choose a bounded method, show the exact context plan, and preserve the user's place in the graph or reader. The result is a shorter workflow and a reproducible security boundary across providers.

Generic chat also has access to every active OKF method. It discovers the capability catalog and loads the narrowest matching instructions without requiring a special prompt phrase. This improves ordinary conversation, but it does not replace the launcher. Natural-language selection is provider work. The launcher gives Studio a deterministic task ID, accepted object scope, and inspectable context plan.

# Task fit

Each origin has a closed task set:

- concepts offer meaning-preserving writing revision, audit, enrichment, cited research, and change impact
- graph selections prioritize change impact, then audit and enrichment
- search results offer cited research, change impact, and enrichment
- validation findings prioritize repair, then audit and cited research
- advisory profile findings prioritize a reviewed migration, then revision and audit
- citations offer cited research, enrichment, and change impact
- sources offer concept authoring, enrichment, cited research, and creation
- intake plans offer enrichment first, then creation and authoring; the kickoff prompt is derived from the plan alone, so what the agent is told matches what the plan resolved (see [Document Intake](document-intake.md))

The author and revise routes use the [OKF Writing](okf-writing.md) contract. Authoring begins from accepted evidence. Revision begins from an existing concept, and it cannot silently become enrichment.

These are the stable task IDs and curated capabilities described by the [Agent Panel](agent-panel.md#okf-task-routing-and-context-preview). Every connected agent receives the same bounded capability kernel or its declared text fallback, so the launcher never invents a provider-specific task. A future provider capability advertisement may narrow the set further. The absence of such a protocol signal does not create a wider route.

# One launcher

Every entry point opens one modal launcher. It names the origin, offers only the matching tasks, and embeds the deterministic context preview before work starts. The launcher has explicit first-use, authentication, unsupported, stale-plan, context-overflow, and busy-thread states.

Connecting an agent temporarily suspends the launcher and returns to the same request after connection or Back. A changed bundle blocks start until Studio refreshes the plan. The launcher lists optional context that exceeds the budget as omitted. If the current thread runs or waits, Studio starts the task in a separate thread and leaves the live turn and draft intact.

Cancel returns focus to the originating control. Starting a task preserves the graph, reader, filters, and open panels. It opens the Agent Panel if needed, and carries the accepted origin into a new task kickoff. No entry point grants a wider tool, network, or write scope. Any proposed bundle change still goes through [reviewed staging](agent-panel.md#context-tools-and-writes).

Create, Revise, Audit, and migration plans can also carry [bounded advisory profile context](profile-aware-authoring.md). The context plan names its local profiles and labels OKF-required, profile-required, and recommended fields before the user starts. Its fingerprint changes with the profile report, and the native session boundary rejects profile context on any other task.

# Keyboard and search

The [Command Palette](command-palette.md) places OKF task shortcuts after the best matching concept. Enter therefore keeps its primary navigation behavior. Arrowing into **OKF tasks** runs the same task IDs and launcher that object actions use. When the user cancels the launcher, focus returns to the top-bar search control.

# Isolation and verification

`OkfTaskLauncher` stories cover ready, first-use, authentication, unsupported, stale, overflow, active-thread conflict, and 360-pixel states. Storybook MCP is the component-isolation screen and runs their interaction and accessibility checks. Whole-app integration separately proves reader kickoff, separate-thread behavior, focus restoration, and unchanged command-palette navigation.

Related architecture: [Agent System](../architecture/agent-system.md). Product sequence: [OKF Agent Specialization](../product/agent-specialization-roadmap.md).
