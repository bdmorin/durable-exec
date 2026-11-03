// STUB (Phase 0, P0-03): a minimal SQLite-backed `ExecutionEnv` that covers exactly what pi-durable's `read`, `write`
// and `edit` tools call. It is NOT the Phase 2 VFS: there are no real directories (a directory exists only as a prefix
// of a stored file), no listing, rename, remove, append/truncate, temp entries or watching; those return
// `FileError("not_supported")`. Shell execution always fails with `ExecutionError("shell_unavailable")`, which is also
// DESIGN §5's default. A missing path is `not_found`; nothing ever falls through to the host file system.
//
// Content lives in `hx_files` (logical POSIX path -> bytes) inside the home, through the shared facade. Phase 2 owns
// the real schema (revisions, blobs, workspaces) and will replace this table; homes written by this stub are throwaway.
// See evidence/P0-03 for the env-conformance baseline this stub reaches.

import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  type BinaryReader,
  type DirReader,
  ExecutionError,
  type ExecutionEnv,
  err,
  FileError,
  type FileInfo,
  type FileWatcher,
  type LineScan,
  LineScanner,
  ok,
  type Result,
  type ShellExecResult,
  type TextLineReader,
} from "@earendil-works/pi-durable/env";
import type { HomeDatabase } from "../db/home-database.ts";

export const STUB_FILES_TABLE = "hx_files";

const encoder = new TextEncoder();

export type SqliteStubEnvOptions = {
  /** File namespace id: equal ids must mean the same `hx_files` rows. */
  readonly id: string;
  /** Logical working directory; relative paths resolve against it. Default `/`. */
  readonly cwd?: string;
};

type FileRow = { content: Uint8Array; mtime_ms: number };

/** Create the stub table if absent, and return an environment over it. */
export async function openSqliteStubEnv(db: HomeDatabase, options: SqliteStubEnvOptions): Promise<SqliteStubEnv> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${STUB_FILES_TABLE} (
       path TEXT PRIMARY KEY NOT NULL,
       content BLOB NOT NULL,
       mtime_ms INTEGER NOT NULL
     ) STRICT`,
  );
  return new SqliteStubEnv(db, options);
}

function aborted(context: Context, path?: string): FileError | undefined {
  return context.abortSignal?.aborted ? new FileError("aborted", "Operation aborted", path) : undefined;
}

function unsupported<T>(operation: string, path?: string): Result<T, FileError> {
  return err(new FileError("not_supported", `${operation} is not supported by the P0-03 stub environment`, path));
}

export class SqliteStubEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly #db: HomeDatabase;

  constructor(db: HomeDatabase, options: SqliteStubEnvOptions) {
    this.#db = db;
    this.id = options.id;
    this.cwd = posix.resolve("/", options.cwd ?? "/");
  }

  /** Logical absolute path. `..` cannot climb above `/`; there is no host path behind it. */
  #resolve(path: string): string {
    return posix.resolve("/", this.cwd, path);
  }

  async #row(path: string): Promise<FileRow | undefined> {
    return this.#db.get<FileRow>(`SELECT content, mtime_ms FROM ${STUB_FILES_TABLE} WHERE path = ?`, path);
  }

  /** A directory exists only as `/` or as a strict prefix of a stored file's path. */
  async #isDirectory(path: string): Promise<boolean> {
    if (path === "/") return true;
    const prefix = `${path}/`;
    const row = await this.#db.get<{ found: number }>(
      `SELECT 1 AS found FROM ${STUB_FILES_TABLE} WHERE substr(path, 1, ?) = ? LIMIT 1`,
      prefix.length,
      prefix,
    );
    return row !== undefined;
  }

  async #info(path: string): Promise<Result<FileInfo, FileError>> {
    const row = await this.#row(path);
    const name = path === "/" ? "/" : posix.basename(path);
    if (row) return ok({ name, path, kind: "file", size: row.content.byteLength, mtimeMs: row.mtime_ms });
    if (await this.#isDirectory(path)) return ok({ name, path, kind: "directory", size: 0, mtimeMs: 0 });
    return err(new FileError("not_found", `No such file: ${path}`, path));
  }

  async #bytes(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const stop = aborted(context, path);
    if (stop) return err(stop);
    const row = await this.#row(path);
    if (row) return ok(new Uint8Array(row.content));
    if (await this.#isDirectory(path)) return err(new FileError("is_directory", `Is a directory: ${path}`, path));
    return err(new FileError("not_found", `No such file: ${path}`, path));
  }

  async absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    return ok(this.#resolve(path));
  }

  async joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
    return ok(posix.join(...parts));
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    const absolute = this.#resolve(path);
    const info = await this.fileInfo(absolute, context);
    return info.ok ? ok(absolute) : err(info.error);
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const stop = aborted(context, path);
    if (stop) return err(stop);
    return ok((await this.#info(this.#resolve(path))).ok);
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    const stop = aborted(context, path);
    if (stop) return err(stop);
    return this.#info(this.#resolve(path));
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    return this.#bytes(this.#resolve(path), context);
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const bytes = await this.#bytes(this.#resolve(path), context);
    return bytes.ok ? ok(new TextDecoder().decode(bytes.value)) : err(bytes.error);
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    const text = await this.readTextFile(path, context);
    if (!text.ok) return err(text.error);
    const lines = text.value.split("\n");
    return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines));
  }

  /** Reads a snapshot taken at open, so the reader keeps seeing the file it opened (as the contract requires). */
  async openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>> {
    void options; // The stub has no symbolic links.
    const absolute = this.#resolve(path);
    const info = await this.fileInfo(absolute, context);
    if (!info.ok) return err(info.error);
    if (info.value.kind === "directory") return err(new FileError("is_directory", `Is a directory: ${absolute}`, absolute));
    const bytes = await this.#bytes(absolute, context);
    if (!bytes.ok) return err(bytes.error);
    return ok(new SnapshotReader(info.value, bytes.value));
  }

  async writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    const absolute = this.#resolve(path);
    const stop = aborted(context, absolute);
    if (stop) return err(stop);
    if (absolute === "/" || (await this.#isDirectory(absolute))) {
      return err(new FileError("is_directory", `Is a directory: ${absolute}`, absolute));
    }
    for (let parent = posix.dirname(absolute); parent !== "/"; parent = posix.dirname(parent)) {
      if (await this.#row(parent)) return err(new FileError("not_directory", `Not a directory: ${parent}`, absolute));
    }
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    await this.#db.run(
      `INSERT INTO ${STUB_FILES_TABLE} (path, content, mtime_ms) VALUES (?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET content = excluded.content, mtime_ms = excluded.mtime_ms`,
      absolute,
      bytes,
      Date.now(),
    );
    return ok(undefined);
  }

  async openTextLineReader(path: string, _context: Context): Promise<Result<TextLineReader, FileError>> {
    return unsupported("openTextLineReader", path);
  }
  async appendFile(path: string, _content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("appendFile", path);
  }
  async truncateFile(path: string, _size: number, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("truncateFile", path);
  }
  async flushFile(path: string, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("flushFile", path);
  }
  async renameFile(sourcePath: string, _destinationPath: string, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("renameFile", sourcePath);
  }
  async listDir(path: string, _context: Context): Promise<Result<FileInfo[], FileError>> {
    return unsupported("listDir", path);
  }
  async openDirReader(path: string, _context: Context): Promise<Result<DirReader, FileError>> {
    return unsupported("openDirReader", path);
  }
  async watch(): Promise<Result<FileWatcher, FileError>> {
    return unsupported("watch");
  }
  async createDir(path: string, _options: unknown, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("createDir", path);
  }
  async remove(path: string, _options: unknown, _context: Context): Promise<Result<void, FileError>> {
    return unsupported("remove", path);
  }
  async createTempDir(): Promise<Result<string, FileError>> {
    return unsupported("createTempDir");
  }
  async createTempFile(): Promise<Result<string, FileError>> {
    return unsupported("createTempFile");
  }
  async cleanup(_context: Context): Promise<void> {}

  async exec(
    _command: string | readonly string[],
    _options: unknown,
    _context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    return err(new ExecutionError("shell_unavailable", "Shell execution is unavailable in the P0-03 stub environment"));
  }
}

class SnapshotReader implements BinaryReader {
  readonly #info: FileInfo;
  readonly #bytes: Uint8Array;
  #closed = false;

  constructor(info: FileInfo, bytes: Uint8Array) {
    this.#info = info;
    this.#bytes = bytes;
  }

  #check(context: Context): FileError | undefined {
    if (this.#closed) return new FileError("invalid", "Reader is closed", this.#info.path);
    return aborted(context, this.#info.path);
  }

  async info(context: Context): Promise<Result<FileInfo, FileError>> {
    const problem = this.#check(context);
    return problem ? err(problem) : ok({ ...this.#info });
  }

  async read(offset: number, length: number, context: Context): Promise<Result<Uint8Array, FileError>> {
    const problem = this.#check(context);
    if (problem) return err(problem);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      return err(new FileError("invalid", "offset and length must be non-negative integers", this.#info.path));
    }
    return ok(this.#bytes.slice(offset, offset + length));
  }

  async scanLines(
    options: { startLine: number; endLine?: number },
    context: Context,
  ): Promise<Result<LineScan, FileError>> {
    const problem = this.#check(context);
    if (problem) return err(problem);
    try {
      const scanner = new LineScanner(options.startLine, options.endLine);
      scanner.push(this.#bytes);
      return ok(scanner.finish());
    } catch (error) {
      return err(new FileError("invalid", String(error), this.#info.path));
    }
  }

  async close(_context: Context): Promise<void> {
    this.#closed = true;
  }
}
