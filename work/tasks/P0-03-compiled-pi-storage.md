---
id: P0-03
title: Compiled binary reopens Pi storage and runs a real file tool
status: open
owner:
branch:
depends_on: [P0-01, P0-02]
owns: [evidence/P0-03/]
---

## Goal

Prove the riskiest packaging claim: a `bun build --compile` executable opens Pi `SqliteStorage` through the P0-02 facade, persists application + Pi state, exits, reopens and reads it back, and invokes a genuine Pi file tool through the intended `ExecutionEnv` boundary. BUILD_PLAN Phase 0 step 2.

## Acceptance

- [ ] Compiled binary (not `bun run`) writes `hx_*` and Pi state into one file; a second invocation reopens both.
- [ ] A real Pi file tool executes against a minimal environment (a stub VFS is fine here; label it — the full VFS is Phase 2).
- [ ] No model request; if a provider is needed to drive the tool, use an offline fixture and label it offline.
- [ ] Evidence states platform explicitly. macOS arm64 is the target; Linux results don't close the macOS criterion.

## Out of scope

- Full VFS surface, CLI commands, real provider turns.

## Notes / handoff

- Design-time probe: pi-durable 1.5.0 state written under Node reopened under Bun 1.4.3 and back. Not compiled, no tools — that's what this task closes.
