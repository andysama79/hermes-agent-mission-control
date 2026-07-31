# Hermes Agent Mission Control

Mission Control is a desktop-plugin-first observability project for multi-profile Hermes workflows.

The goal is to give the user a visual surface for questions like:

- which profiles are active right now
- what work is being handed off
- who was active when
- where pipeline time may be getting lost
- how a multi-agent workflow is behaving overall

## Scope of this branch

This branch adds the **first working runtime**:

- a Hermes Desktop plugin shell
- wildcard event capture through `host.onEvent('*')`
- heuristic event normalization
- synthetic profile activity events
- session-local persistence through `ctx.storage` when available
- a recent-event feed and basic status chip

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

## Validation

- `node --check desktop-plugins/agent-mission-control/plugin.js`
- JSON parse validation for `schemas/mission-control-event.schema.json`

## Current runtime behavior

The plugin currently:

- subscribes to `host.onEvent('*')`
- emits synthetic `profile.activity` events when the active profile changes
- keeps a rolling event buffer in memory
- hydrates and persists that buffer through `ctx.storage` when supported
- classifies many raw envelopes heuristically into normalized event types/statuses
- surfaces a recent event feed plus persistence diagnostics

## GitHub remote

- https://github.com/andysama79/hermes-agent-mission-control
