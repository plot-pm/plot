import { spawn, type ChildProcess } from 'node:child_process';

import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { TreeBlob } from '../../ports/refs.js';
import { parseTree, type TreeRecord } from '../../rules/git-tree.js';

/** Ten seconds: how long one request may wait for its complete answer. */
export const OBJECTS_TIMEOUT_MS = 10_000;

/** How many drops within {@link DROP_WINDOW_MS} pause the reader. */
export const DROP_LIMIT = 3;

/** Sixty seconds: the window {@link DROP_LIMIT} counts drops in. */
export const DROP_WINDOW_MS = 60_000;

/** Sixty seconds: how long a paused reader answers `unaskable` and starts no process. */
export const PAUSE_MS = 60_000;

/** The longest header line the reader waits for before it reads the stream as out of step. */
const HEADER_MAX = 4096;

/** How many drops {@link ObjectsBatch.drops} keeps. */
const DROPS_KEPT = 16;

/** A full object id, SHA-1 or SHA-256, optionally followed by `:<path>`. */
const OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})(?::[^\n\0]*)?$/;

/** A full object id alone. */
const BARE_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `<oid> <type> <size>`, the header git writes for an object it found. */
const FOUND_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/;

/** The four object types git stores. */
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';

/** An object git did not find, or could not name uniquely. The process stays. */
export interface ObjectAbsent {
  found: false;
  /** `missing` for no such object or path, `ambiguous` for a name matching several. */
  why: 'missing' | 'ambiguous';
}

/** What `info` answers for an object git found. */
export interface ObjectFound {
  found: true;
  /** The object id git resolved the name to. */
  oid: string;
  type: ObjectType;
  /** The object's size in bytes. */
  size: number;
}

/** What `contents` answers for an object git found: {@link ObjectFound} and its bytes. */
export interface ObjectBody extends ObjectFound {
  body: Buffer;
}

/** One `info` answer. */
export type ObjectInfo = ObjectFound | ObjectAbsent;

/** One `contents` answer. */
export type ObjectContents = ObjectBody | ObjectAbsent;

/**
 * Why the reader ended a process: no answer within the bound, the process
 * exited or closed stdout, stdin raised `EPIPE`, or the stream held a header
 * the reader could not match to its request.
 */
export type DropCause = 'timeout' | 'exit' | 'epipe' | 'out-of-step';

/** One process the reader ended. */
export interface Drop {
  /** When, in the reader's clock. */
  at: number;
  cause: DropCause;
}

/** Where and how the reader runs `git`. */
export interface ObjectsBatchOptions {
  /** The checkout `git` runs in. */
  repoRoot: string;
  /** The git directory to read objects from; `git` finds it from `repoRoot` when absent. */
  gitDir?: string;
  /** The bound per request, in milliseconds; {@link OBJECTS_TIMEOUT_MS} when absent. */
  timeoutMs?: number;
  /** Extra environment for the process, on top of this process's own. */
  env?: Readonly<Record<string, string>>;
  /** The clock the drop rule reads; `Date.now` when absent. */
  now?: () => number;
}

/** One long-lived `git cat-file --batch-command` and the requests it answers in order. */
export interface ObjectsBatch {
  /**
   * Reads each object's type, size and bytes in one request.
   *
   * @param objects - full object ids, or `<oid>:<path>`; never a ref name.
   * @returns one answer per object, in the order given; `failed` when the
   *   process was dropped before the answer completed; `unaskable` for a
   *   refused name, a paused or closed reader, without writing to the process.
   */
  contents(objects: readonly string[]): Promise<PortResult<readonly ObjectContents[]>>;
  /**
   * Reads each object's type and size in one request.
   *
   * @param objects - as for {@link ObjectsBatch.contents}.
   * @returns as for {@link ObjectsBatch.contents}, without bytes.
   */
  info(objects: readonly string[]): Promise<PortResult<readonly ObjectInfo[]>>;
  /** The processes this reader ended, oldest first, at most 16. */
  drops(): readonly Drop[];
  /** Fails every pending request, closes the process's stdin, and refuses every later request. */
  close(): void;
}

/** One request waiting for its answers. */
interface Pending {
  readonly kind: 'contents' | 'info';
  readonly objects: readonly string[];
  readonly answers: (ObjectContents | ObjectInfo)[];
  readonly settle: (result: PortResult<readonly (ObjectContents | ObjectInfo)[]>) => void;
}

/** The running process and the bytes it has written that no answer consumed yet. */
interface Live {
  readonly child: ChildProcess;
  chunks: Buffer[];
  buffered: number;
  /** How many buffered bytes the head answer needs before parsing is worth trying. */
  awaiting: number;
}

/** Lets a pipe or process stop holding the event loop open, where it can. */
const unrefOf = (handle: unknown): void => {
  (handle as { unref?: () => void } | null | undefined)?.unref?.();
};

/**
 * Starts a reader of git objects for one repository.
 *
 * The first request starts `git cat-file --batch-command --buffer -z`; every
 * later request reuses it. Each request is written at once and followed by
 * `flush`, and git answers requests in the order they were written, so the
 * reader matches answers to a FIFO of pending requests and frames each body by
 * its declared byte length.
 *
 * A request accepts a full object id or `<oid>:<path>`, never a ref name, so a
 * process that outlives a ref move cannot answer from the old ref. A path
 * holding a newline or NUL is refused before it reaches the process.
 *
 * The process and its pipes are `unref`'d and hold no process open; while a
 * request is pending its timer does. Its stdin closes when this process ends,
 * and git exits with it.
 *
 * | event | answer |
 * | --- | --- |
 * | no complete answer within `timeoutMs` | `SIGKILL`, every pending request `failed`, the process dropped |
 * | exit, closed stdout, `EPIPE` on stdin | the same |
 * | a header the reader cannot match | the same |
 * | `<name> missing` or `<name> ambiguous` | that object's answer; the process stays |
 * | the next request after a drop | a new process |
 * | {@link DROP_LIMIT} drops within {@link DROP_WINDOW_MS} | `unaskable` and no process for {@link PAUSE_MS} |
 *
 * @param options - where and how to run `git`.
 * @returns the reader.
 */
export const objectsBatch = (options: ObjectsBatchOptions): ObjectsBatch => {
  const timeoutMs = options.timeoutMs ?? OBJECTS_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const queue: Pending[] = [];
  const dropped: Drop[] = [];
  let live: Live | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const armHead = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = queue.length === 0 ? undefined : setTimeout(() => drop('timeout'), timeoutMs);
  };

  const drop = (cause: DropCause): void => {
    const ended = live;
    if (ended === undefined) return;
    live = undefined;
    ended.child.kill('SIGKILL');
    dropped.push({ at: now(), cause });
    if (dropped.length > DROPS_KEPT) dropped.shift();
    for (const pending of queue.splice(0)) pending.settle(failed());
    armHead();
  };

  const paused = (): boolean => {
    const at = now();
    const recent = dropped.filter((one) => at - one.at < DROP_WINDOW_MS + PAUSE_MS);
    for (let last = DROP_LIMIT - 1; last < recent.length; last += 1) {
      const span = recent[last]!.at - recent[last - (DROP_LIMIT - 1)]!.at;
      if (span < DROP_WINDOW_MS && at - recent[last]!.at < PAUSE_MS) return true;
    }
    return false;
  };

  /** Joins the buffered chunks into one buffer and returns it. */
  const joined = (state: Live): Buffer => {
    if (state.chunks.length !== 1) state.chunks = [Buffer.concat(state.chunks, state.buffered)];
    return state.chunks[0]!;
  };

  const consume = (state: Live, bytes: number): void => {
    const rest = joined(state).subarray(bytes);
    state.chunks = [rest];
    state.buffered = rest.length;
    state.awaiting = 0;
  };

  /**
   * Reads one answer for the head request off the buffer.
   *
   * @returns `true` when an answer was consumed, `false` when more bytes are
   *   needed, `null` when the stream is out of step.
   */
  const readOne = (state: Live, head: Pending): boolean | null => {
    const buf = joined(state);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) return buf.length > HEADER_MAX ? null : false;
    const header = buf.toString('utf8', 0, nl);
    const asked = head.objects[head.answers.length]!;
    if (header === `${asked} missing` || header === `${asked} ambiguous`) {
      head.answers.push({ found: false, why: header.endsWith('missing') ? 'missing' : 'ambiguous' });
      consume(state, nl + 1);
      return true;
    }
    const m = FOUND_HEADER.exec(header);
    if (!m || (BARE_OID.test(asked) && m[1] !== asked)) return null;
    const found: ObjectFound = { found: true, oid: m[1]!, type: m[2] as ObjectType, size: Number(m[3]) };
    if (head.kind === 'info') {
      head.answers.push(found);
      consume(state, nl + 1);
      return true;
    }
    const end = nl + 1 + found.size;
    if (buf.length < end + 1) {
      state.awaiting = end + 1;
      return false;
    }
    if (buf[end] !== 0x0a) return null;
    head.answers.push({ ...found, body: Buffer.from(buf.subarray(nl + 1, end)) });
    consume(state, end + 1);
    return true;
  };

  const onData = (state: Live, chunk: Buffer): void => {
    if (state !== live) return;
    state.chunks.push(chunk);
    state.buffered += chunk.length;
    if (state.buffered < state.awaiting) return;
    while (state === live && state.buffered > 0) {
      const head = queue[0];
      if (head === undefined) return drop('out-of-step');
      const read = readOne(state, head);
      if (read === null) return drop('out-of-step');
      if (!read) return;
      if (head.answers.length === head.objects.length) {
        queue.shift();
        head.settle(answered(head.answers));
        armHead();
      }
    }
  };

  const start = (): Live => {
    const args = [
      ...(options.gitDir === undefined ? [] : ['--git-dir', options.gitDir]),
      'cat-file', '--batch-command', '--buffer', '-z',
    ];
    const child = spawn('git', args, {
      cwd: options.repoRoot,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const state: Live = { child, chunks: [], buffered: 0, awaiting: 0 };
    const lost = (cause: DropCause) => (): void => {
      if (state === live) drop(cause);
    };
    child.on('error', lost('exit'));
    child.on('exit', lost('exit'));
    child.stdout?.on('data', (chunk: Buffer) => onData(state, chunk));
    child.stdout?.on('end', lost('exit'));
    child.stdin?.on('error', lost('epipe'));
    unrefOf(child);
    unrefOf(child.stdin);
    unrefOf(child.stdout);
    return state;
  };

  const ask = <T extends ObjectContents | ObjectInfo>(
    kind: Pending['kind'],
    objects: readonly string[],
  ): Promise<PortResult<readonly T[]>> => {
    if (closed) return Promise.resolve(unaskable('object reader closed'));
    const refused = objects.find((name) => !OBJECT_NAME.test(name));
    if (refused !== undefined) {
      return Promise.resolve(unaskable(`object reader takes an object id or <oid>:<path>, not ${JSON.stringify(refused)}`));
    }
    if (objects.length === 0) return Promise.resolve(answered<readonly T[]>([]));
    if (live === undefined && paused()) {
      return Promise.resolve(unaskable(`object reader paused: ${DROP_LIMIT} drops within ${DROP_WINDOW_MS / 1000} s`));
    }
    const state = live ?? (live = start());
    return new Promise((resolve) => {
      queue.push({
        kind,
        objects,
        answers: [],
        settle: resolve as Pending['settle'],
      });
      if (queue.length === 1) armHead();
      state.child.stdin?.write(objects.map((name) => `${kind} ${name}\0`).join('') + 'flush\0');
    });
  };

  return {
    contents: (objects) => ask<ObjectContents>('contents', objects),
    info: (objects) => ask<ObjectInfo>('info', objects),
    drops: () => [...dropped],
    close: () => {
      closed = true;
      const ended = live;
      live = undefined;
      for (const pending of queue.splice(0)) pending.settle(failed());
      armHead();
      ended?.child.stdin?.end();
    },
  };
};

/** The raw length of an object id written as `hex` hex digits. */
const oidBytesOf = (oid: string): number => oid.length / 2;

/**
 * Lists every blob under `dir` at a commit, as `git ls-tree -r <commit> -- <dir>`
 * does, by reading tree objects through the reader.
 *
 * Reads `<commit>:<dir>` first, then each level of subtrees in one request, and
 * returns the blobs depth-first in tree order, the order `ls-tree -r` prints.
 * `dir` naming a file lists that file alone; `dir` naming nothing answers an
 * empty list, as `ls-tree` does. Submodule entries are not blobs and are left
 * out.
 *
 * @param reader - the object reader.
 * @param commit - a full commit or tree object id.
 * @param dir - a path relative to the repository root; `''` or `.` for the root.
 * @returns the blobs with their mode, oid and full path; `failed` for a failed
 *   read or a tree that does not parse; `unaskable` as the reader answers it.
 */
export const listBlobsThrough = async (
  reader: ObjectsBatch,
  commit: string,
  dir: string,
): Promise<PortResult<readonly TreeBlob[]>> => {
  const base = dir.replace(/\/+$/, '').replace(/^\.$/, '');
  const top = await reader.contents([`${commit}:${base}`]);
  if (!top.ok) return top;
  const first = top.value[0]!;
  if (!first.found) return answered<readonly TreeBlob[]>([]);
  const oidBytes = oidBytesOf(commit);

  if (first.type !== 'tree') {
    const slash = base.lastIndexOf('/');
    const parent = await listBlobsThrough(reader, commit, slash === -1 ? '' : base.slice(0, slash));
    return parent.ok ? answered(parent.value.filter((blob) => blob.path === base)) : parent;
  }

  const trees = new Map<string, readonly TreeRecord[]>();
  const parsed = parseTree(first.body, oidBytes);
  if (parsed === null) return failed<readonly TreeBlob[]>();
  trees.set(first.oid, parsed);
  let level = parsed;
  while (level.length > 0) {
    const wanted = [...new Set(level.filter((one) => one.kind === 'tree' && !trees.has(one.oid)).map((one) => one.oid))];
    if (wanted.length === 0) break;
    const read = await reader.contents(wanted);
    if (!read.ok) return read;
    const next: TreeRecord[] = [];
    for (const [at, answer] of read.value.entries()) {
      if (!answer.found || answer.type !== 'tree') return failed<readonly TreeBlob[]>();
      const records = parseTree(answer.body, oidBytes);
      if (records === null) return failed<readonly TreeBlob[]>();
      trees.set(wanted[at]!, records);
      next.push(...records);
    }
    level = next;
  }

  const blobs: TreeBlob[] = [];
  const walk = (oid: string, prefix: string): void => {
    for (const record of trees.get(oid)!) {
      const path = prefix === '' ? record.name : `${prefix}/${record.name}`;
      if (record.kind === 'tree') walk(record.oid, path);
      else if (record.kind === 'blob') blobs.push({ mode: record.mode, sha: record.oid, path });
    }
  };
  walk(first.oid, base);
  return answered<readonly TreeBlob[]>(blobs);
};
