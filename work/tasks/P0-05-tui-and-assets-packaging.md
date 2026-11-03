---
id: P0-05
title: Terminal renderer and embedded browser asset from compiled binary
status: review
owner: P0-05-agent
branch: agent/P0-05-tui-and-assets
depends_on: [P0-01]
owns: [evidence/P0-05/]
---

## Goal

Packaging gate, not a UI build: pick a TypeScript terminal renderer by exercising it inside the compiled binary, and prove a bundled browser asset is served by Bun's native HTTP server from that same binary. BUILD_PLAN Phase 0 step 5.

## Acceptance

- [x] Renderer candidates exercised for: streaming output, line input, abort (Ctrl-C) without killing the process, clean terminal restoration, non-TTY fallback with no escape-code contamination on stdout. (Linux x86_64, pty-driven; macOS not exercised.)
- [x] All of the above work from `dist/` compiled output, not just `bun run`. (Linux x86_64 only.)
- [x] Compiled binary serves an embedded HTML/JS asset on loopback with no CDN or remote fetch. (Linux x86_64; empty cwd, cleared env.)
- [x] Choice + rejected alternatives recorded in evidence.

## Out of scope

- Chat features, web API, auth (Phases 3 and 5).

## Notes / handoff

2026-11-03 (P0-05-agent): Evidence in [evidence/P0-05/README.md](../../evidence/P0-05/README.md).

- **Renderer: `@earendil-works/pi-tui` 1.5.0** (`TuiMainScreen` + `ProcessTerminal`). Ink 8.0.0 was rejected: it does not compile without a devtools stub plugin, it has ambient `DEV` behaviour, and it pulls in a heavy dependency tree. Raw readline was rejected for interactive use because input typed during a stream gets garbled. pi-tui is **not** added to `package.json` yet because nothing imports it. Phase 3 should run `bun add --exact @earendil-works/pi-tui@1.5.0`.
- Requirements Phase 3 inherits:
  - Interactive mode only when `stdin.isTTY && stdout.isTTY`. Neither library degrades on its own.
  - Install SIGTERM/SIGHUP handlers that call `tui.stop()`. Without them the cursor stays hidden and bracketed-paste/kitty modes stay on.
  - Ctrl-C is input byte `0x03` in raw mode, not SIGINT.
  - Decide what to do about pi-tui's `PI_TUI_*` env debug/log knobs.
- Added `src/web/server.ts`: an embedded HTML import served on 127.0.0.1 with `development: false`. It has a test and is not wired into `main.ts`/Commander; `serve --web` (Phase 5) owns that.
- Open:
  - macOS arm64 run.
  - Human visual check in real terminals.
  - Browser rendering.
  - An ADR for the renderer choice in `docs/decisions/`. It was not written here because it is outside this task's allowed paths.
