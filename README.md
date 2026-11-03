# Horcrux

**The file is the system.**

A planned local-first agent application: one Bun/TypeScript executable activates an agent whose configuration, conversations, virtual workspace, knowledge, discussions, inbox, and user-owned telemetry live in one SQLite home.

Pi-durable supplies agent execution and persisted conversation/task state. A custom execution environment supplies database-backed files and explicit access to permitted host resources. Fossil is architectural prior art, not a runtime dependency or SCM requirement.

## Current status

Design and implementation handoff only. No application, package setup, or CLI commands have been implemented in this repository. References to commands in the design describe the intended interface, not commands available to run now.

- [Current architecture and behavioral contracts](docs/DESIGN.md)
- [Build sequence, integration gates, and acceptance scenarios](docs/BUILD_PLAN.md)
- [Original Fossil handoff — historical, superseded](docs/history/horcrux-durable-fossil-handoff.md)

## This iteration

- Bun-native executable with Commander-style deterministic commands and interactive chat.
- One authoritative SQLite home; no implicit `~/.config` or project discovery.
- Pi-durable hosted directly, with configuration loaded from that home.
- SQLite-backed virtual filesystem; host file/process/network access requires explicit authorization.
- Local-only, configurable operational telemetry; no automatic remote exporter or beacon.
- Optional embedded web interface: the application process owns the agent; browser and terminal clients watch and submit work.
- Wiki, discussion, and inbox features built on the same application state.
- Inspectable history and portable snapshots without requiring source-control semantics.

Native desktop GUI, Fossil compatibility, distributed deployment, and rewriting pi-durable are not part of this build.

## Working in this repo

Multiple agents work here in parallel. Read [AGENTS.md](AGENTS.md) for the protocol, then pick an open task from [work/BOARD.md](work/BOARD.md). Proof goes in [evidence/](evidence/), exercised decisions in [docs/decisions/](docs/decisions/).

## Start building

Follow Phase 0 of [BUILD_PLAN.md](docs/BUILD_PLAN.md): pin the exercised dependencies, prove the compiled Bun/Pi state path, choose and exercise single-owner exclusion, and validate shared asynchronous SQLite transactions. Then implement the persistent workspace and complete agent interaction against the contracts in [DESIGN.md](docs/DESIGN.md).

The local reference project `/Users/bdmorin/src/github.com/disler/durable-pi` demonstrates independently owned harnesses with reconnectable web/terminal clients. Borrow that lifecycle pattern, not its multi-database or home-directory configuration layout.
