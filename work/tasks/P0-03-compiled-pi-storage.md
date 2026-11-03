---
id: P0-03
title: Compiled binary reopens Pi storage and runs a real file tool
status: review
owner: P0-03-agent
branch: agent/P0-03-compiled-pi-storage
depends_on: [P0-01, P0-02]
owns: [evidence/P0-03/]
---

## Goal

Prove the riskiest packaging claim: a `bun build --compile` executable opens Pi `SqliteStorage` through the P0-02 facade, persists application + Pi state, exits, reopens and reads it back, and invokes a genuine Pi file tool through the intended `ExecutionEnv` boundary. BUILD_PLAN Phase 0 step 2.

## Acceptance

- [x] Compiled binary (not `bun run`) writes `hx_*` and Pi state into one file; a second invocation reopens both. *(Linux x86_64)*
- [x] A real Pi file tool executes against a minimal environment (a stub VFS is fine here; label it — the full VFS is Phase 2). *(`write` + `read` tools vs `SqliteStubEnv`, Linux x86_64)*
- [x] No model request; if a provider is needed to drive the tool, use an offline fixture and label it offline. *(pi-ai faux provider, `hx-offline-fixture`; strace: 0 socket/connect)*
- [ ] Evidence states platform explicitly. macOS arm64 is the target; Linux results don't close the macOS criterion. *(Platform stated; macOS arm64 not exercised, so left open)*

## Out of scope

- Full VFS surface, CLI commands, real provider turns.

## Notes / handoff

- Design-time probe: pi-durable 1.5.0 state written under Node reopened under Bun 1.4.3 and back. Not compiled, no tools — that's what this task closes.
- Evidence: [evidence/P0-03/README.md](../../evidence/P0-03/README.md).
- Added: `src/workspace/sqlite-stub-env.ts` (+ test, env-conformance baseline 2/22), hidden Phase 0 probe subcommand `probe-p0-03` (`src/cli/probe-p0-03.ts`, + compiled-binary test). Remove the probe once Phase 1/2 commands cover this path.
- **Out-of-lane edit:** `package.json` `compile` script now passes `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. By default Bun 1.4.4 compiled executables autoload `.env` and `bunfig.toml` from the cwd, and a cwd `bunfig.toml` `preload` executes arbitrary code (reproduced). Consider an ADR for compile flags.
- Open: macOS arm64 run; `edit`/`bash` tools not driven in a turn; crash/kill mid-turn and `-wal` recovery; VFS-write vs tool-result atomicity (DESIGN §4) is not addressed by the stub.
