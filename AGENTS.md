# Project AGENTs.md

This is a project Brian is exploring. failure is fun, no bad ideas. There is however... wreckage..

Several agents work this repo in parallel. This file is the operating manual for all of them: read it, then read your task file, then work.

## 1. Orientation (read in this order)

1. [README.md](README.md) — what Horcrux is, in one screen.
2. [docs/DESIGN.md](docs/DESIGN.md) — the behavioral contract. **Wins every disagreement.**
3. [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) — phases, acceptance criteria, verification policy.
4. [docs/decisions/](docs/decisions/) — exercised decisions (ADRs). These refine DESIGN; they never silently contradict it.
5. [work/BOARD.md](work/BOARD.md) and your task file in [work/tasks/](work/tasks/).

[docs/history/](docs/history/) is preserved wreckage: context, never instructions. Do not implement the Fossil-runtime architecture.

## 2. Hard rules (distilled from DESIGN / BUILD_PLAN)

- **No empty scaffolds.** Don't create `src/*` directories or modules ahead of real code. The source boundaries in BUILD_PLAN are responsibilities, not a skeleton to stamp out.
- **Pin everything.** pi-durable / pi-ai / Chord at the exercised 1.5.0 family; no floating SDK versions; commit the lockfile.
- **Never pass an async callback to Bun's `db.transaction()`.** Explicit BEGIN/COMMIT/ROLLBACK behind a serialized queue. Never hold a transaction across a model call or subprocess.
- **No ambient anything:** no implicit `~/.config`, `.env`, cwd discovery, telemetry exporter, update check, CDN asset, or runtime package install.
- **Compile only via `bun run compile`.** A bare `bun build --compile` binary autoloads `.env`/`bunfig.toml` from the cwd, and a hostile `bunfig.toml` preload runs arbitrary code ([ADR 0004](docs/decisions/0004-compile-flags.md)).
- **Pi owns `pi_*`.** Touch Pi state only through Pi APIs. App tables are `hx_*`.
- **No credentials in the repo, the home file, logs, or evidence.** Reference env-var *names* only.
- **Offline fixtures are labeled as offline.** Never claim the real-provider path works on mock evidence.
- **No ORM, plugin system, distributed scheduler, or Fossil compat layer** without a demonstrated requirement (write an ADR first).
- Throwaway probe scripts live in `scratch/` (gitignored). Keep the *findings* in `evidence/`, delete the scripts.

## 3. Multi-agent protocol

### One task, one branch, one owner

- Work is defined in `work/tasks/<ID>-<slug>.md`. One file per task, so parallel agents never fight over a shared status file.
- Branch per task. Local agents: `agent/<ID>-<slug>`. Cloud sessions use the branch the harness assigns — record it in the task file.
- Prefer a separate git worktree per local agent (`git worktree add ../hx-<ID> -b agent/<ID>-<slug>`).

### Claiming

1. `git fetch origin` and check nobody else claimed it: look at `status:`/`owner:` in the task file on `main` **and** on remote branches (`git log --all --oneline -- work/tasks/<ID>-*.md`).
2. Check `depends_on:` — every dependency must be `done` on `main`, or you work against its branch and say so in the task file.
3. Set `status: claimed`, `owner:`, `branch:`; make that your **first commit and push it immediately** so the claim is visible.
4. If you abandon it, set `status: open`, write a handoff note in the task file, push.

Statuses: `open` → `claimed` → `review` → `done`, plus `blocked` (say on what).

### Lanes — stay inside `owns:`

Each task lists the paths it owns. Edit outside your lane only when unavoidable, and call it out in the PR. Shared files have rules:

| Shared file | Rule |
| --- | --- |
| `package.json`, `bun.lock` | Adding a dependency = note it in the task file and PR. On conflict, take `main`'s version and re-run `bun add`; never hand-merge the lockfile. |
| `docs/DESIGN.md`, `docs/BUILD_PLAN.md` | Change only to record an exercised decision, in the same PR as the evidence. Contract changes need Brian. |
| `work/BOARD.md` | Only add/split tasks or update dependencies. Live status lives in task files. |
| `AGENTS.md` | Process changes only, in their own commit. |

### Finishing

- Acceptance criteria in the task file are the definition of done — with evidence, not vibes.
- Record proof in `evidence/<ID>/README.md` (see [evidence/README.md](evidence/README.md)): platform, versions, exact commands, trimmed output, what was *not* exercised.
- Decisions that later work depends on (adapter, ownership mechanism, renderer, schemas, formats) get an ADR in `docs/decisions/`.
- Set `status: review`, open a PR against `main`, link task + evidence + ADR. Brian (or a designated integrator) merges and flips to `done`.
- Discovered work → new task file (next free ID in that phase) + a line in BOARD. Don't scope-creep the current branch.

### Commits

Small, imperative subject, body says *why*. Reference the task ID: `P0-02: serialize nested transaction attempts`.

## 4. Environment reality check

- **Target vs. cloud:** Phase 0 ownership/packaging proofs target **macOS arm64** (Bun 1.4.3, Node 26.12.0 observed). Cloud sessions run **Linux x86_64** (Bun 1.4.4, Node 22). Phase 0 passed on Linux; every macOS box is still open (see work/tasks/P0-06). Linux results are useful but are *not* the macOS proof — label evidence with the platform and leave macOS-only criteria open.
- **Reference project** `/Users/bdmorin/src/github.com/disler/durable-pi` exists only on Brian's Mac. Cloud agents can't read it; don't invent its contents. If a task needs it, mark `blocked: needs local reference` or ask.
- **Model credentials:** none are assumed. Real-provider tasks need an operator-approved env-var binding; report the gap rather than mocking around it.

## 5. Verification policy (short form)

Permanent tests for plausible user-visible failures (rollback/order, exclusion, path/grant boundaries, lifecycle, precedence, duplicate admission, snapshot consistency). No tests that restate source. For every significant feature also run the real CLI/browser path. Full policy: BUILD_PLAN § Verification policy.
