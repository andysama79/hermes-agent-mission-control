# MVP Desktop Plugin Architecture

## Goal

Build an opt-in desktop plugin that gives the user a live, low-friction observability view into multi-profile Hermes activity.

The MVP should answer four questions well:

1. what profile is active now?
2. what events are happening now?
3. what handoffs recently happened?
4. where should deeper adapters plug in next?

## Design principles

- **plugin-first**: no fork of Hermes desktop required
- **opt-in**: disabled by default; user enables when they want visibility
- **normalized events**: adapters emit one common schema
- **read-mostly**: prefer listening to desktop/gateway events over mutating systems
- **incremental instrumentation**: start with generic event capture, then add subsystem-specific parsers
- **safe degradation**: when a subsystem is unavailable, show capture health instead of fake metrics

## System layers

### 1. Presentation layer

Implemented as a Hermes desktop plugin pane plus a lightweight status-bar chip.

Responsibilities:
- show current profile context
- display capture status
- render recent event feed
- surface profile activity cards and recent handoff cards
- let the user filter noisy sessions quickly
- provide a raw event inspector for envelope discovery
- surface adapter health
- later: tabs for Live, Timeline, Costs, Graph

### 2. Runtime collection layer

Lives inside `plugin.js` for the initial MVP.

Responsibilities:
- subscribe to `host.onEvent('*')`
- sample `host.state.profile` and other safe desktop state atoms
- normalize raw envelopes into `MissionControlEvent`
- keep an in-memory ring buffer for the current session
- persist/hydrate recent events through `ctx.storage` when available

### 3. Adapter layer

Adapter concept separates transport-specific parsing from the UI.

Initial adapters:
- `desktopEventAdapter` — wraps wildcard Hermes desktop events
- `profileStateAdapter` — snapshots current profile/session context

Current classification approach:
- wildcard desktop events are normalized through broad string/field heuristics
- profile changes are also emitted as synthetic `profile.activity` events from a polling observer
- subsystem adapters are still conceptual, but their output contract is already represented in the normalized event stream

Planned adapters:
- `delegationAdapter`
- `cronAdapter`
- `kanbanAdapter`
- `processAdapter`
- `costAdapter`

Adapter contract:
- input: raw host event or state snapshot
- output: zero or more normalized `MissionControlEvent` records
- failure mode: never throw into render; return empty + diagnostic

### 4. Metrics layer

For the MVP, metrics are intentionally shallow and local:
- event count captured this session
- last event timestamp
- active profile label
- adapter health summary
- handoff-like event count
- profiles seen this session
- persistence health / hydration state
- per-profile event/failure/completion counts
- simple pipeline hints derived from recent failures, queues, and routing density

Later metrics:
- active vs idle duration by profile
- handoff count by edge
- queue depth
- median completion latency
- rough token/cost rollups

### 5. Persistence layer

The current cut uses `ctx.storage` opportunistically for a rolling recent-event cache.

Planned progression:
1. in-memory ring buffer
2. `ctx.storage` rolling cache for recent events
3. optional plugin backend or JSONL ledger for durable history
4. later database-backed analytics if needed

## Event flow

```text
Hermes host state / live events
          │
          ▼
  runtime collector in plugin
          │
          ▼
   subsystem adapters normalize
          │
          ▼
   MissionControlEvent ring buffer
          │
          ├──► live pane cards/feed
          └──► future metrics reducers
```

## Normalized event model

Each event should be normalized into the schema defined in:

- `docs/EVENT-SCHEMA.md`
- `schemas/mission-control-event.schema.json`

Core fields:
- `event_id`
- `ts`
- `event_type`
- `source_profile`
- `target_profile`
- `session_id`
- `run_id`
- `task_id`
- `status`
- `model`
- `provider`
- `tokens_in`
- `tokens_out`
- `estimated_cost_usd`
- `duration_ms`
- `metadata`

## MVP UI composition

### Status bar chip

Shows:
- mission control enabled indicator
- current profile name
- current captured event count

### Main pane

Sections:
1. **Live profile** — current profile and capture heartbeat
2. **Pipeline hints** — lightweight heuristics that call out possible bottlenecks
3. **Profile activity cards** — who is active, who is failing, who is routing
4. **Recent handoffs** — explicit `source → target` cards
5. **Filter row** — profile / event type / status chips
6. **Recent events** — newest normalized events first
7. **Raw inspector** — selected normalized event plus raw payload
8. **Capture health** — adapter list + diagnostics

## Why a desktop plugin first

- aligns with how you want to “peek in sometimes”
- fastest to iterate
- zero server deployment burden
- natural place to render live panes and status chips
- keeps observability close to the work surface

## Known unknowns

These require live Hermes inspection during implementation:
- exact wildcard event envelope shapes
- stable event names for delegation/cron/kanban/process lifecycle
- whether token/provider/cost metadata is present in events or must be inferred
- whether `ctx.storage` is enough for history or a backend route is preferable

## Current practical limitation

Because this repo is being built outside a live Hermes desktop runtime, the event normalization layer currently uses conservative heuristics rather than envelope-specific parsers. The next iteration should be driven by captured real event samples from the desktop app.

Another limitation: activity cards and hints are currently count-based rather than time-window or span-based. They are useful for triage and visibility, but should not yet be treated as exact throughput accounting.

## Implementation sequence

### Phase 0 — now
- scaffold repo
- define schema
- create plugin shell
- validate syntax

### Phase 1
- inspect real event envelopes in Hermes desktop
- map common envelope shapes
- add adapter parsers
- add handoff detection heuristics

### Phase 2
- add session-local persistence
- add throughput counters
- add profile activity durations

### Phase 3
- add cost estimation and historical replay
- add graph/timeline views
- consider dashboard surface
