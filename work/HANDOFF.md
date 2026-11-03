# Session handoff: 2026-11-03

Coordinator notes from the session that organized the repo and ran Phase 0. Read [AGENTS.md](../AGENTS.md) and [BOARD.md](BOARD.md) first. This file covers what they don't.

## State at close

- All work is on branch `llm/gifted-galileo-atanlf`, pushed. `main` is untouched at `bc2731a`, and no PR is open.
- `bun install && bun test && bun run typecheck` → 68 pass, 0 fail, clean (Linux x86_64, Bun 1.4.4).
- **Phase 0: done on Linux.** ADRs 0001–0004 in [docs/decisions/](../docs/decisions/). Evidence in `evidence/P0-0{1..5}/`.
- **Phase 1: decomposed, not started.** P1-01 was in flight when the session closed. The agent got no further than its claim commit, and the unfinished worktree was lost with the container. The card has been reset to `open`. Start from the card, not from any `agent/P1-01-*` branch.

## Needs Brian

1. **P0-07, macOS arm64 verification.** Every Phase 0 proof is Linux only. Highest risk: the ownership lock's macOS errno path has never executed. Run `bun test src/home/ownership.test.ts` on the Mac first.
2. **Phase 2 shell question.** 6 of pi-durable's 22 env-conformance cases need a working `exec`, but DESIGN says shell is unavailable by default. Either exclude them from the conformance target or design a confined exec. The current stub passes 2/22, pinned as a baseline in `src/workspace/sqlite-stub-env.test.ts`.
3. **Real-provider turn.** Only pi-ai's offline `faux` fixture has driven a turn. Phase 3 needs an operator-approved credential binding.

## Traps found (don't rediscover them)

- **Compiled Bun binaries autoload cwd `.env`/`bunfig.toml`.** A `bunfig.toml` `preload` runs arbitrary code. Always build with `bun run compile` ([ADR 0004](../docs/decisions/0004-compile-flags.md)).
- **POSIX fcntl lock on the home is dropped** when SQLite closes its fd in the same process. Ownership uses flock on `<home>-hxowner`. Never delete that file while the home is owned ([ADR 0002](../docs/decisions/0002-home-ownership.md)).
- **Bun `db.transaction()` + async callback** leaves rows committed after an awaited throw. Use `openHomeDatabase` (Chord adapter) only ([ADR 0001](../docs/decisions/0001-sqlite-adapter.md)).
- **pi-tui** doesn't degrade on non-TTY (it wrote 251 escape bytes to a pipe), needs SIGTERM/SIGHUP → `tui.stop()`, and reads `PI_TUI_*` env vars, which must be stripped per DESIGN § 6 ([ADR 0003](../docs/decisions/0003-terminal-renderer.md)).
- **Pi `requestId` reuse** returns the original submission rather than running a new turn. Use fresh homes or fresh IDs in probes.
- **`SqliteStorage.close()` / `harness.close()` close the shared DB.** Close Pi last.
- Inspecting a home with Python `sqlite3` `mode=ro` leaves `-wal`/`-shm` files. Use `immutable=1`.

## Known debt

- Hidden `horcrux probe-p0-03` command and stub `hx_files` schema: remove/replace once Phase 1/2 cover them. Homes created by the stub are throwaway.
- DESIGN § 4 atomicity (VFS write vs Pi tool-result commit, stable operation id) is not addressed yet. That's Phase 2/3.
- Two lifecycle scripts are blocked by `bun install` (`protobufjs` postinstall, `@google/genai` preinstall). Nothing needs them so far.

## How this session ran it (worked well)

- One worktree per task via isolated subagents; the coordinator merged with `--no-ff`, then **re-ran the full suite itself** before marking `done`.
- Brief agents to `git checkout -b agent/<ID> llm/gifted-galileo-atanlf` first, since isolated worktrees can start at an old commit.
- Cross-lane findings were relayed between running agents (e.g. P0-02's single-connection facts → P0-04), which caught the fcntl trap early.
- Max useful parallelism next: P1-01 alone, then P1-02 ∥ P1-03 (∥ P0-07 on a Mac), then P1-04.
