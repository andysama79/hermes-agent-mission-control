# Hermes Agent Mission Control

Mission Control is a desktop-plugin-first observability project for multi-profile Hermes workflows.

The goal is to give the user a visual surface for questions like:

- which profiles are active right now
- what work is being handed off
- who was active when
- where pipeline time may be getting lost
- how a multi-agent workflow is behaving overall

## Scope of this first branch

This branch establishes the **foundation** of the project:

- repository layout
- event schema
- architecture notes
- MVP backlog

It does **not** yet ship the runtime plugin implementation.

## Planned repo layout

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

## Design direction

Mission Control should begin as an **optional Hermes Desktop pane** rather than a backend-heavy platform.

Why:
- fastest path to usefulness
- low friction for the user to check in occasionally
- no extra deployment burden
- natural place for live event feed, handoffs, and profile activity views

## GitHub remote

- https://github.com/andysama79/hermes-agent-mission-control
