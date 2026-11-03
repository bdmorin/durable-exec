# 0003: pi-tui as the terminal renderer

- Status: accepted (Linux x86_64, pty-driven); macOS arm64 and human visual check pending
- Task: P0-05
- Evidence: [../../evidence/P0-05/README.md](../../evidence/P0-05/README.md)

## Context

BUILD_PLAN requires choosing a renderer by exercising streaming, input, abort, restoration and non-TTY behavior inside the compiled binary.

## Options considered

- **`@earendil-works/pi-tui` 1.5.0.** It compiles cleanly, is the same family as pi-durable, has 3 small deps, and needs no WASM or native code. In the compiled binary it passed all of: streaming, queued input mid-stream, first Ctrl-C aborts, second exits, terminal restored, and 0 escape bytes on piped stdout.
- **Ink 8.0.0.** Rejected: it fails to compile without a devtools stub plugin, has ambient `DEV=true` WebSocket behavior, ~40 packages, and stray escapes on stderr.
- **Raw readline.** Rejected for interactive use, because input typed during a stream gets garbled into output. Kept as the pattern for noninteractive mode.

## Decision

Use pi-tui (`TuiMainScreen` + `ProcessTerminal`) for interactive chat. Add it with `bun add --exact @earendil-works/pi-tui@1.5.0` when Phase 3 first imports it. The embedded browser asset is served by `src/web/server.ts` (Bun HTML import, loopback only).

## Consequences (Phase 3 requirements)

- Go interactive only when `stdin.isTTY && stdout.isTTY`. Neither library degrades by itself: pi-tui wrote 251 escape bytes to a pipe.
- Install SIGTERM/SIGHUP handlers that call `tui.stop()`. In raw mode Ctrl-C is input byte `0x03`, not SIGINT.
- pi-tui reads `PI_TUI_*` env debug/log switches and can write crash dumps to the temp dir. This collides with DESIGN § 6's allowlisted environment. Strip or neutralize `PI_TUI_*` before constructing the TUI unless an explicit Horcrux option enables diagnostics.
- Still unverified: macOS arm64, real-terminal visuals, resize/paste/alt-screen, browser rendering, and proof that the web binary makes no outbound connections.
