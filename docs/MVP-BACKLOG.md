# MVP Backlog

## Immediate next tasks

1. Capture and catalog real `host.onEvent('*')` envelopes from Hermes desktop.
2. Identify stable signals for:
   - profile switches
   - delegated child start/finish
   - cron start/finish
   - background process lifecycle
3. Replace heuristic event classifiers with envelope-specific parsers where possible.
4. Add a tiny reducer for:
   - events per minute
   - active profile dwell time
   - recent handoff edges
5. Promote the raw event inspector into a structured envelope-learning workflow.
6. Add filters with saved presets for noisy multi-profile sessions.
7. Add profile-lane and handoff-lane timeline views.
8. Add confidence flags so the user can distinguish heuristic vs parser-backed classifications.

## MVP stretch goals

- bottom-pane timeline tab
- recent handoff cards
- today cost estimate badge
- replay / export JSONL

## Non-goals for MVP

- exact billing accuracy across all providers
- cross-machine fleet observability
- long-term warehousing
- full dashboard analytics suite
