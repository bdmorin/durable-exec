---
id: P0-05
title: Terminal renderer and embedded browser asset from compiled binary
status: open
owner:
branch:
depends_on: [P0-01]
owns: [evidence/P0-05/]
---

## Goal

Packaging gate, not a UI build: pick a TypeScript terminal renderer by exercising it inside the compiled binary, and prove a bundled browser asset is served by Bun's native HTTP server from that same binary. BUILD_PLAN Phase 0 step 5.

## Acceptance

- [ ] Renderer candidates exercised for: streaming output, line input, abort (Ctrl-C) without killing the process, clean terminal restoration, non-TTY fallback with no escape-code contamination on stdout.
- [ ] All of the above work from `dist/` compiled output, not just `bun run`.
- [ ] Compiled binary serves an embedded HTML/JS asset on loopback with no CDN or remote fetch.
- [ ] Choice + rejected alternatives recorded in evidence.

## Out of scope

- Chat features, web API, auth (Phases 3 and 5).

## Notes / handoff
