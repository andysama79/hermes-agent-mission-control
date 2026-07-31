# MVP Desktop Plugin Architecture

## Goal

Build an opt-in Hermes Desktop plugin that exposes a lightweight observability layer for multi-profile Hermes workflows.

The first implementation should eventually answer:

1. what profile is active now?
2. what events are happening now?
3. what handoffs recently happened?
4. where should deeper adapters plug in next?

## Design principles

- **plugin-first**: avoid forking Hermes Desktop
- **opt-in**: the user can enable it only when they want visibility
- **normalized events**: all sources should reduce to one event shape
- **incremental instrumentation**: start simple and harden from real event samples
- **safe degradation**: show uncertainty rather than fake precision

## System layers

### 1. Presentation layer

A Hermes Desktop pane plus lightweight status indicator.

Planned responsibilities:
- show current profile context
- show recent event activity
- surface handoff visibility
- later: costs, timelines, graph views

### 2. Runtime collection layer

A plugin-side event collector should:
- subscribe to safe host events
- sample profile/session context
- normalize raw envelopes into `MissionControlEvent`
- keep a local recent-event buffer

### 3. Adapter layer

Adapters should translate subsystem-specific events into the shared schema.

Planned adapters:
- desktop event adapter
- profile state adapter
- delegation adapter
- cron adapter
- kanban adapter
- process adapter
- usage/cost adapter

### 4. Metrics layer

Initial metrics should stay shallow:
- event count
- last event time
- active profile label
- recent handoff count

### 5. Persistence layer

The foundation assumes local-first persistence.

Planned progression:
1. in-memory ring buffer
2. lightweight local persistence
3. optional durable ledger later

## Event flow

```text
Hermes state/events
        │
        ▼
plugin collector
        │
        ▼
adapters normalize
        │
        ▼
MissionControlEvent buffer
        │
        ├──► live pane
        └──► future metrics reducers
```

## Current limitation

This branch is architecture-first and intentionally does not yet include the runtime implementation.
