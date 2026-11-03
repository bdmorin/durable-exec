---
id: P0-07
title: Re-run Phase 0 proofs on macOS arm64
status: open
owner:            # needs Brian's Mac or a macOS runner
branch:
depends_on: [P0-02, P0-03, P0-04, P0-05]
owns: [evidence/P0-07/]
---

## Goal

Every Phase 0 decision is proven on Linux x86_64 only, and macOS arm64 is the target. Close the gap, or find out early that a decision needs revisiting.

## Acceptance

- [ ] `bun install && bun test && bun run typecheck` green on macOS arm64 (record Bun/Node/macOS versions).
- [ ] `bun test src/home/ownership.test.ts` green. This is the highest risk: the libSystem errno path and `EWOULDBLOCK=35` have never executed, and the BSD flock/fcntl interaction is untested ([ADR 0002](../../docs/decisions/0002-home-ownership.md)).
- [ ] `bun run compile`, then the P0-03 probe write/read/inspect from an empty temp dir ([evidence/P0-03](../../evidence/P0-03/README.md) has the commands); `-wal`/`-shm` behavior after clean exit noted.
- [ ] Cwd autoload guard still holds ([ADR 0004](../../docs/decisions/0004-compile-flags.md)).
- [ ] pi-tui human check in Terminal.app/iTerm/Ghostty: streaming, Ctrl-C abort, quit, terminal restored ([ADR 0003](../../docs/decisions/0003-terminal-renderer.md)).
- [ ] Embedded web page renders in a real browser.

## Notes / handoff
