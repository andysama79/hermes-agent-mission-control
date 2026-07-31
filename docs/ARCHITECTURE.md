# MVP Desktop Plugin Architecture

## Goal

Build an opt-in Hermes Desktop plugin that exposes a lightweight observability layer for multi-profile Hermes workflows.

The working runtime should answer:

1. what profile is active now?
2. what events are happening now?
3. where can deeper adapters plug in next?

## Design principles

- **plugin-first**: avoid forking Hermes Desktop
- **opt-in**: the user enables it when they want visibility
- **normalized events**: all sources should reduce to one event shape
- **incremental instrumentation**: start simple and harden from real event samples
- **safe degradation**: show uncertainty rather than fake precision

## Runtime collection layer

The current runtime lives inside `plugin.js` and:
- subscribes to `host.onEvent('*')`
- samples active profile state
- emits normalized `MissionControlEvent` records
- keeps a rolling buffer of recent events
- persists that buffer through `ctx.storage` when available

## Adapter direction

The current classification layer is heuristic and local to the plugin.

Current practical adapters:
- desktop event adapter
- profile state adapter

Planned adapters:
- delegation adapter
- cron adapter
- kanban adapter
- process adapter
- usage/cost adapter

## Metrics in this branch

Kept intentionally simple:
- event count
- last event time
- active profile label
- persistence health

## Current limitation

Because this runtime was built outside a live Hermes Desktop session, its event classification is intentionally conservative and heuristic. The next branch should focus on making the pane more useful for an operator while still exposing raw-ish signals honestly.
