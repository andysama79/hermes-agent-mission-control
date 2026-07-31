# Hermes Agent Mission Control

Optional observability layer for multi-profile Hermes workflows.

This repo starts the MVP desktop plugin architecture for a visual control plane that helps answer:

- which profiles are active right now
- what handoffs are happening
- who was active when
- where pipeline time is being spent
- rough cost / throughput signals

## MVP scope

The MVP focuses on a **desktop plugin pane** first:

- live active profile indicator
- event feed sourced from Hermes desktop `host.onEvent('*')`
- pluggable telemetry adapters for delegation / cron / kanban / process events
- normalized event schema
- metrics pipeline ready for later cost + throughput rollups

This repo intentionally keeps the first implementation thin:

- no custom backend service yet
- no database dependency yet
- no dashboard page yet
- no exact billing integration yet

## Current status

Included now:

- architecture docs
- normalized event schema
- repo layout for plugin-first delivery
- opt-in desktop plugin skeleton (`defaultEnabled: false`)
- live event capture pane using safe Hermes desktop SDK primitives
- heuristic event normalization for delegation / cron / kanban / process-like envelopes
- session-local rolling buffer persisted through `ctx.storage` when available
- profile activity cards and lightweight session metrics
- recent handoff cards and pipeline hints
- raw event inspector for debugging real Hermes envelope shapes
- profile/type/status filters for investigating noisy sessions

Not included yet:

- exact RPC integrations for sessions/cron/kanban internals
- production cost model lookup table
- historical charts and Sankey/Gantt views

## Repo layout

```text
.
├── README.md
├── .gitignore
├── docs/
│   ├── ARCHITECTURE.md
│   ├── EVENT-SCHEMA.md
│   └── MVP-BACKLOG.md
├── schemas/
│   └── mission-control-event.schema.json
└── desktop-plugins/
    └── agent-mission-control/
        └── plugin.js
```

## Plugin installation target

When ready to test in a real Hermes desktop environment, copy:

```text
desktop-plugins/agent-mission-control/plugin.js
```

into:

```text
$HERMES_HOME/desktop-plugins/agent-mission-control/plugin.js
```

Then open Hermes Desktop and run **Reload desktop plugins** if hot reload does not pick it up automatically.

## Validation done in this scaffold

- `node --check desktop-plugins/agent-mission-control/plugin.js`
- JSON parse validation for `schemas/mission-control-event.schema.json`

## Current MVP behavior

The plugin currently:

- subscribes to `host.onEvent('*')`
- emits synthetic `profile.activity` events when the active profile changes
- keeps a rolling event buffer in memory
- hydrates and persists that buffer through `ctx.storage` when supported
- classifies many raw envelopes heuristically into normalized event types/statuses
- surfaces adapter health, persistence health, and simple session metrics in the pane
- summarizes per-profile activity and handoff density
- lets the user filter by profile / event type / status
- lets the user inspect both normalized and raw event payloads

## Recommended next steps

1. wire adapter-specific event parsers for `delegate_task`, cron, and kanban
2. add computed metrics (active/idle dwell time, handoff latency, completion counts)
3. promote the raw event inspector into an envelope-learning workflow
4. add per-profile lanes / timeline view
5. add a dashboard/web history surface later

## GitHub remote

Remote repo created:

- https://github.com/andysama79/hermes-agent-mission-control

Notes:

- this environment still has no `gh` CLI configured
- I was able to create the remote using the existing Git credential store
- the local scaffold is linked to `origin`, but I have **not committed or pushed** the files yet
