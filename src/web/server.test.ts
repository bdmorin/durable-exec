import { afterAll, expect, test } from "bun:test";
import { LOOPBACK, startWebServer } from "./server.ts";

const server = startWebServer();
afterAll(() => server.stop(true));

// Any scheme-relative or absolute URL would mean a remote asset dependency (CDN, analytics, fonts).
const REMOTE_URL = /(?:https?:)?\/\/[a-z0-9.-]+/i;

test("binds to loopback by default", () => {
  expect(server.hostname).toBe(LOOPBACK);
  expect(server.url.hostname).toBe(LOOPBACK);
});

test("serves the embedded page and its script with no remote references", async () => {
  const page = await fetch(new URL("/", server.url));
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toStartWith("text/html");
  const html = await page.text();
  expect(html).not.toMatch(REMOTE_URL);

  const srcs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    expect(src.startsWith("/")).toBe(true);
    const asset = await fetch(new URL(src, server.url));
    expect(asset.status).toBe(200);
    expect(await asset.text()).not.toMatch(REMOTE_URL);
  }
});

test("unknown paths are 404, not a directory listing or fallback page", async () => {
  const res = await fetch(new URL("/../../etc/passwd", server.url));
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("Not Found");
});
