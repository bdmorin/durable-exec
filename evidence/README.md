# Evidence

Proof that a task's acceptance criteria were actually exercised. One directory per task: `evidence/<ID>/README.md`, plus small output captures if needed. Probe scripts themselves go in `scratch/` (gitignored) and are deleted once findings are recorded here.

Each record states:

- **Platform:** OS, arch, Bun and Node versions, relevant package versions.
- **Commands:** exact, copy-pasteable.
- **Output:** trimmed to what proves the point. No secrets, tokens, or full environment dumps.
- **Result:** which acceptance criteria this closes.
- **Not exercised:** what this does *not* prove (e.g. "Linux only — macOS criterion still open", "offline provider fixture, not a real model").
