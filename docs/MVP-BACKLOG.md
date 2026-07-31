# MVP Backlog

## Implemented in this branch

- desktop plugin shell
- wildcard event capture
- heuristic event normalization
- local rolling event buffer
- persistence via `ctx.storage` when available
- basic recent event feed

## Next implementation steps

1. add profile activity cards
2. add recent handoff cards
3. add filters by profile / event type / status
4. add a raw event inspector for debugging envelope shapes
5. add lightweight pipeline hints for the operator
6. distinguish heuristic observations from parser-backed ones later
