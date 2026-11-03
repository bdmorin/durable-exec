# P0-05 evidence: terminal renderer and embedded browser asset from the compiled binary

- **Platform:** Linux x86_64 (cloud container, no real TTY), Bun 1.4.4, Node 22.23.4, Python 3.13 (pty harness only). **macOS arm64 not exercised.**
- **Candidates (exact versions, installed only in a throwaway `scratch/` project, not in `package.json`):** `@earendil-works/pi-tui` 1.5.0 (deps: `marked` 18.0.11, `marked-cjk-friendly` 0.1.2, `get-east-asian-width` 1.6.0); `ink` 8.0.0 + `react` 19.3.1 (~40 transitive packages incl. `yoga-layout` WASM); raw `node:readline` + hand-written output (no deps).
- **Decision:** **`@earendil-works/pi-tui` 1.5.0**, main-screen renderer (`TuiMainScreen` + `ProcessTerminal`), behind an app-owned TTY guard. Details below.

## How the terminal was driven

There is no TTY in the container. Each probe was compiled with `bun build --compile` and run under a Python harness (`pty.openpty`) that:

- gives the child a new session with the pty slave as controlling terminal, stdin and stdout, at 80x24, `TERM=xterm-256color`, env otherwise only `PATH`; stderr goes to a **separate pipe** (so diagnostics are distinguishable);
- types keystrokes **one byte at a time, 15 ms apart** (sending `"hello\r"` as one write makes Ink see a paste, not Enter — a harness artifact, fixed before the results below);
- timestamps every chunk read from the pty master;
- samples `tcgetattr(slave)` at the first keystroke (*during*) and after exit (*after*), and compares *after* to the pre-spawn attributes. The slave stays open, so this is the real line-discipline state the shell would inherit.
- `script -qc` was used only to see Ink's startup crash; all results come from the harness.

Each probe does the same thing: `> ` line input; submitting a line streams 20 simulated tokens at 100 ms (~2 s); a line submitted while streaming is queued and runs next; Ctrl-C while streaming aborts that stream (process stays up); Ctrl-C while idle arms, a second Ctrl-C exits; `/quit` exits; SIGTERM handled by stopping the renderer then exiting 143. When `stdout` is not a TTY, the probe never starts the renderer and writes plain tokens to stdout, diagnostics to stderr.

Scenarios: **abort** = type `hello⏎` at 0.8 s, `queued1⏎` at +0.5 s (mid-stream), `^C` at +0.4 s, wait 2.8 s, `^C`, `^C`. **quit** = `hi⏎`, wait 2.8 s, `/quit⏎`. **term** = `hello⏎`, SIGTERM at +0.6 s.

## Commands

```bash
mkdir -p scratch/p05 && cd scratch/p05      # gitignored; deleted after
echo '{"name":"p05","private":true,"type":"module"}' > package.json
bun add --exact @earendil-works/pi-tui@1.5.0 ink@8.0.0 react@19.3.1
bun build ./src/pitui.ts --compile --outfile dist/pitui        # 53 modules, 109.4 MB
bun build ./src/rl.ts    --compile --outfile dist/rl           # 2 modules, 109.1 MB
bun build ./src/ink.tsx  --compile --outfile dist/ink          # FAILS: Could not resolve "react-devtools-core"
bun build ./src/ink.tsx  --compile --external react-devtools-core --outfile dist/ink   # builds; binary crashes at startup
bun build-ink.ts   # Bun.build + onResolve plugin stubbing react-devtools-core -> works, 110.3 MB
python3 ptyharness.py {abort|quit|term} out/<name>-<scenario> -- ./dist/<name>
printf 'first line\nsecond line\n' | ./dist/<name> > out.txt 2> err.txt   # non-TTY
printf 'x\n' | timeout 3 ./dist/<name> --force-tui > out.txt 2> err.txt   # renderer started with no guard
```

## Results (compiled binaries)

| Criterion | pi-tui 1.5.0 | Ink 8.0.0 | readline + raw writes |
| --- | --- | --- | --- |
| Compiles with plain `bun build --compile` | yes | **no** (needs a build plugin stubbing `react-devtools-core`; `--external` crashes at startup) | yes |
| Streaming, incremental | yes: 20 diff-rendered frames ~100 ms apart (t=0.95…3.77 s) | yes, but redraws the whole frame each update | yes |
| Line input while streaming | yes: `queued1` echoed in input line, `[queued: queued1]`, ran after abort | yes | **garbled**: `The quick brown queuedfox 1` (typed echo interleaves with tokens) |
| Ctrl-C aborts stream, process survives | yes (`[aborted]` at +35 ms, queued stream then ran to `[done]`) | yes | yes (readline `SIGINT` event) |
| 2nd Ctrl-C / `/quit` exits 0 | yes / yes | yes / yes | yes / yes |
| termios during → after (ICANON/ECHO/ISIG) | off → restored, identical to before | off → restored | off → restored |
| Cursor / modes at exit | last `ESC[?25h`; `?2004h`/`?2004l` 1/1; kitty push `>7u` / pop `<u` 1/1; no alt screen | last `ESC[?25h`, but written to **stderr** too | no cursor/mode sequences used |
| SIGTERM mid-stream (with app handler) | exit 143, all restored | exit by signal; `signal-exit` restored cursor | exit 143, restored |
| Non-TTY (stdout+stdin piped), guarded | 243 B stdout, **0 ESC bytes**; stderr diagnostics only | 0 ESC | 0 ESC |
| Non-TTY, renderer started anyway | **251 ESC bytes on stdout** (queries, `?2004h`, `?25l`, frames) | crash: `Raw mode is not supported` | n/a |

Trimmed bytes, pi-tui abort run (timeline seconds; `<<SENT>>` = harness keystroke):

```
startup:  ESC[?2004h ESC[>7u ESC[?u ESC]7501;?ESC\ ESC[c ESC[?25l ESC[?2026h ...  "> "
  1.354  ESC[?2026h ESC[5A\r ESC[2K echo(hello): The quick brown fox
  1.334  <<SENT 'queued1\r'>>
  1.355  ... you: queued1
  1.735  <<SENT '\x03'>>
  1.770  ... echo(hello): The quick brown fox jumps over the lazy [aborted]
  1.858  ... echo(queued1):
  3.767  ... agent keeps streaming tokens to you now [done]
  4.540  <<SENT '\x03'>>   ->  [idle] press Ctrl-C again to exit
  4.948  <<SENT '\x03'>>
exit tail: ... ESC[?25h ESC[?2004l ESC[<u          stderr: [diag] EXIT_CLEAN   exit 0
termios before {ICANON,ECHO,ISIG}=on  during=off  after=on (tcgetattr identical)
```

pi-tui was also run from an empty temp directory (`RUN_CWD=$(mktemp -d)`): same results, directory still empty afterwards. Its optional native helpers (clipboard/modifier `.node` prebuilds) are not embedded; the loader tolerates this ("Standalone binaries do not have an installed TUI package") and only tries the Linux X11 helper when `DISPLAY` is set.

### Finding: the app must own signal-driven restoration

pi-tui restores on `tui.stop()` and registers a `process.on("exit")` restore, but a SIGTERM with **no app handler** (`--no-sig` run) exited -15 with termios restored (Bun resets tty mode at exit) yet left **cursor hidden (last seq `ESC[?25l`), bracketed paste on (0× `?2004l`), and kitty keyboard mode pushed**. Phase 3 chat must install SIGTERM/SIGHUP handlers that call `tui.stop()`. In raw mode Ctrl-C arrives as input byte `0x03`, not SIGINT; abort/exit policy lives in the input listener. SIGKILL cannot be restored by anyone.

### Finding: the app must own the TTY decision

Neither library degrades on its own when output is piped (pi-tui emits escapes; Ink crashes). Interactive mode should require `stdin.isTTY && stdout.isTTY`; otherwise use a plain path that never constructs the renderer. With that guard, all three probes produced zero ESC bytes on stdout.

## Decision and rejected alternatives

**Chosen: `@earendil-works/pi-tui` 1.5.0.** Compiles with no build tricks. In the compiled binary it passed every criterion. It is the same 1.5.0 family as pi-durable/pi-ai, with 3 small dependencies and no WASM/native requirement. It gives differential main-screen rendering (keeps scrollback), synchronized output, an `Input`/`Editor` that stays usable during streaming, and `stop()` that undoes every mode it set. Phase 3 should pin it with `bun add --exact @earendil-works/pi-tui@1.5.0` when the first real consumer lands. It is **not** in `package.json` yet: no committed code imports it, and the no-empty-scaffolds rule applies.

- **Ink 8.0.0, rejected.** The default compile fails. It needs a custom `Bun.build` plugin to stub `react-devtools-core`. With `--external` the binary crashes at startup with `Cannot find package 'react-devtools-core' from '/$bunfs/root/ink'`, even with `DEV` unset. Its reconciler reads ambient `DEV=true` and, if devtools is resolvable, opens a WebSocket to `ws://localhost:8097`, which goes against the no-ambient-network rule. It brings React plus ~40 packages including yoga WASM. It writes `ESC[?25h` to stderr at exit and crashes without a raw-mode stdin. Its rendering itself worked (yoga WASM loads in the compiled binary).
- **Raw readline + hand-written ANSI, rejected for interactive use.** Abort and restoration work, but typing during a stream corrupts the line (`queuedfox 1`). Fixing that means writing a redraw engine, which is what pi-tui already is. It stays as the pattern for the **non-interactive** path: plain `process.stdout.write`, no renderer.

## Embedded browser asset (B)

Committed `src/web/server.ts`: `startWebServer()` = `Bun.serve({ hostname: "127.0.0.1", port, development: false, routes: { "/": page } })`, where `page` is an HTML import of `src/web/client/index.html` (which loads `client/main.ts`). Test: `src/web/server.test.ts`.

```bash
bun build ./scratch/p05/src/web-entry.ts --compile --outfile scratch/p05/dist/web   # entry just calls startWebServer
cd "$(mktemp -d)" && env -i PATH=/usr/bin:/bin PORT=47805 /abs/path/dist/web &
curl -sS -D - http://127.0.0.1:47805/
```

```
cwd=/tmp/tmp.i75PwKLLfY contents_before_curl=[]
url=http://127.0.0.1:47805/
HTTP/1.1 200 OK
Content-Type: text/html;charset=utf-8
  <script type="module" crossorigin src="/chunk-fjdp8hw6.js"></script></head>
GET /chunk-fjdp8hw6.js -> HTTP/1.1 200 OK, Content-Type: text/javascript;charset=utf-8
  // ../../src/web/client/main.ts
  var app = document.getElementById("app"); ...
absolute URLs in served bytes (expect none): none
GET /nope -> 404
http://192.0.2.2:47805/ (container's non-loopback IP) -> curl: (7) Couldn't connect
SIGTERM -> exit=0
```

The binary was run with a cleared environment from an empty temp directory, so the HTML and JS came from inside the executable, not from the checkout. Bun bundled the TS script at compile time and served it under a hashed path. With `development: false` no HMR client or websocket is injected.

`bun test`: 5 pass (3 new: loopback bind, page + every referenced asset is 200 with no `//host` URL, unknown path 404). `bun run typecheck` clean.

## Not exercised

- **macOS arm64** (the target). Linux only. pi-tui ships darwin prebuilds that are optional, but nothing was run on macOS.
- **Human visual check** of rendering, colours, wrapping and resize in real terminal emulators (iTerm2, Terminal.app, kitty, tmux). Only bytes were inspected. Terminal capability queries (kitty `?u`, OSC 7501, DA1) got no reply on the bare pty; behaviour when a real terminal answers is unverified.
- Window resize (SIGWINCH), paste, multi-line `Editor`, `TuiAltScreen`, Windows.
- Mixed case `stdin` TTY + `stdout` piped (the guard logic covers it, but it was not run).
- Proof of zero outbound network for the web binary: a no-network namespace could not be set up (no `ip` tool to bring up `lo`). The evidence is the served bytes having no remote URLs, plus a cleared env and empty cwd.
- Browser rendering of the page (no browser in the container). Only curl was used.
- pi-tui ambient knobs, still to be decided for Phase 3: it reads env vars such as `PI_TUI_WRITE_LOG` (writes a log file at that path), `PI_TUI_DEBUG` (writes to `/tmp/tui`) and `PI_TUI_DEBUG_REDRAW`, and crash dumps fall back to the OS temp dir. Phase 3 should decide whether to scrub these from the environment or document them as explicit debug switches.
- No ADR written yet (outside this task's allowed paths). The renderer decision above should be lifted into `docs/decisions/` by the integrator.
