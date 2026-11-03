# Agent horcrux: pi-durable + Fossil

> Historical handoff — superseded. The current design is [Horcrux: the file is the system](../DESIGN.md), with its [implementation plan](../BUILD_PLAN.md). It uses Bun, pi-durable, and an application-owned SQLite home with a virtual filesystem. Fossil remains prior art; integrating or rewriting the Fossil runtime is no longer the build direction. The original exploration below is preserved for context, not as implementation instructions.

Explore a portable, durable lifecycle container for an agent: its configuration, conversations, tasks, work products, project history, and audit trail travel together in a SQLite database.

Brian’s inspiration is [Fossil](https://fossil-scm.org/): a standalone executable that provides version control, tickets, wiki, forum, chat, and a web interface, with project data in a SQLite repository. The agent would use [pi-durable](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) for resumable execution and Fossil for project history and human-facing lifecycle management.

The working concept is:

```text
agent.fossil — one SQLite database
  ├── Fossil repository and project history
  ├── pi-durable tables, with a namespace prefix
  └── agent configuration and integration tables

agent runner
  ├── owns pi-durable state and supervises workers
  ├── exposes a detachable TUI
  └── records selected agent activity as Fossil artifacts
```

This is a **concept to investigate, not a validated implementation**. The shared database would be the agent’s portable state container; the runner, model access, credentials, and external dependencies remain separate.

Key findings and questions:

- Pi-durable documents SQLite table prefixes for sharing a database and says one process owns a storage at a time. Investigate a single runtime supervising subprocesses, with the TUI able to detach while work continues.
- Fossil synchronizes its own [versioned artifacts](https://fossil-scm.org/home/doc/trunk/www/fileformat.wiki), not arbitrary SQLite tables. A Fossil clone must **not** be assumed to contain the pi-durable state. Design and test explicit export, replication, backup, and restore.
- Determine whether embedding pi-durable tables in a Fossil repository is supported and survives Fossil upgrades, rebuilds, concurrent access, and maintenance. Compare it with separate databases before committing to shared storage.
- Define how configuration becomes first-class and versioned; which agent events and outputs become Fossil artifacts; and how to link those artifacts back to the original execution.
- Design for crash recovery and ambiguous external effects. Resuming a task does not guarantee that an external action was performed exactly once.
- Distinguish a useful audit trail from a complete or tamper-evident one. Keep credentials outside the portable file.
- Pi-durable documents SQLite WAL mode and notes that its default durability settings may lose the newest commits on power or host failure. Test consistent live backups and recovery rather than copying only the main file.

The goal is **an agent’s working continuity and its project’s institutional memory in one portable home**, with explicit, testable boundaries. Investigate first; don’t assume the shared-file approach is safe just because both systems use SQLite.

Related prior art: [SELF / selfdb](https://fzakaria.com/2026/08/24/actually-queryable-executables) demonstrates an experimental Linux executable that is itself a writable SQLite database. It inspired the original conversation but is not a requirement for this design.