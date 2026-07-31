# Mission Control Event Schema

## Purpose

All observability sources should normalize into one event model so the UI and metrics reducers do not care whether a record came from desktop events, delegation, cron, kanban, or process tracking.

## Canonical shape

```json
{
  "event_id": "evt_01jmc...",
  "ts": "2026-07-31T11:30:00.000Z",
  "event_type": "profile.activity",
  "source_profile": "default",
  "target_profile": "coder",
  "session_id": "20260731_...",
  "run_id": "delegation_...",
  "task_id": "kanban_...",
  "status": "running",
  "model": "openai/gpt-5.4",
  "provider": "openai",
  "tokens_in": 1200,
  "tokens_out": 450,
  "estimated_cost_usd": 0.0231,
  "duration_ms": 12450,
  "metadata": {
    "title": "Implement issue triage panel",
    "raw_event_type": "delegate.completed"
  }
}
```

## Required fields

- `event_id`
- `ts`
- `event_type`
- `status`
- `metadata`

## Important optional fields

- `source_profile`
- `target_profile`
- `session_id`
- `run_id`
- `task_id`
- `model`
- `provider`
- `tokens_in`
- `tokens_out`
- `estimated_cost_usd`
- `duration_ms`

## Suggested normalized event types

- `profile.activity`
- `profile.idle`
- `handoff.created`
- `handoff.accepted`
- `delegate.started`
- `delegate.completed`
- `delegate.failed`
- `cron.started`
- `cron.completed`
- `cron.failed`
- `kanban.claimed`
- `kanban.completed`
- `process.started`
- `process.completed`
- `usage.observed`
- `error.observed`
