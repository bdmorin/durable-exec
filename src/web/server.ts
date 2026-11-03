import page from "./client/index.html";

/** Loopback is the default bind address (DESIGN §8); non-loopback needs an explicit, reviewed capability. */
export const LOOPBACK = "127.0.0.1";

/**
 * Serve the embedded browser client with Bun's native HTTP server.
 * The HTML import is bundled at compile time, so the executable needs no files on disk.
 * `development: false` keeps Bun from injecting its HMR client.
 */
export function startWebServer(options: { port?: number } = {}): Bun.Server<undefined> {
  return Bun.serve({
    hostname: LOOPBACK,
    port: options.port ?? 0,
    development: false,
    routes: { "/": page },
    fetch: () => new Response("Not Found", { status: 404 }),
  });
}
