# 0004: Compiled binary never autoloads cwd config

- Status: accepted (Linux x86_64, reproduced twice independently)
- Task: P0-03
- Evidence: [../../evidence/P0-03/README.md](../../evidence/P0-03/README.md)

## Context

DESIGN § 6 forbids ambient configuration: no `.env`, no project discovery. On Bun 1.4.4, a `bun build --compile` executable by default loads `.env` and `bunfig.toml` from its **current working directory**. A cwd `bunfig.toml` containing `preload = ["./evil.ts"]` executes arbitrary code inside the binary. Running `horcrux` in a hostile directory would therefore run that directory's code.

## Decision

Every compile passes `--no-compile-autoload-dotenv --no-compile-autoload-bunfig` (see the `compile` script in `package.json`). `src/cli/probe-p0-03.test.ts` runs the compiled binary from a cwd seeded with `.env`, a preload `bunfig.toml` and `evil.ts`, and asserts nothing loaded. The test fails if the flags are removed.

## Consequences

- Never build release binaries with a bare `bun build --compile`. Any new build script must carry both flags, and the guard test must cover it.
- Re-check on every Bun upgrade: new autoload behaviors (e.g. tsconfig, package.json) would need matching flags.
