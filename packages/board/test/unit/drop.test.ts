// `POST /api/registry/drop`: it removes the manifest the READER found, or it
// does not claim to.
//
// **THE BUG THIS FILE PINS.** #420 taught the reader to resolve the manifest
// directory through `plot-config.sh` (the `Agent registry` key), so a board
// served from one worktree reads the dispatcher's manifests in another. The
// write path was left joining the raw `.plot/agents` constant, so a Drop looked
// in the BOARD's own worktree while the file sat in the dispatcher's checkout —
// and answered `dropped=true` over a manifest that still existed. The row
// returned on the next pulse and nothing distinguished the action from a no-op.
//
// The load-bearing assertions are therefore two, and both are asserted with the
// **configured directory differing from the repo-relative default** — a test
// using the default alone passes against the broken code:
//
//   1. Item 7 — a drop removes the file the reader found, in the configured dir.
//   2. Item 8 — a drop that removes nothing does not report success by looking
//      in the wrong place. A manifest present in the configured dir is never
//      answered "no manifest found" because the endpoint looked at the default.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { handleDrop, type DropOptions, type DropResult } from '../../src/server/drop.js';
import { AGENT_MANIFEST_DIR, type LivenessResolver } from '../../src/server/registry.js';

/** The real helper scripts, so a test can resolve the directory through the shell. */
const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A repo root, nested one level down so a spawning command's scratch lands inside it. */
function repo(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-drop-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Point the `Agent registry` key at a repo-relative directory. */
function configFile(root: string, value: string): void {
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    `# Repo\n\n## Plot Config\n\n- **Agent registry:** \`${value}\`\n`,
  );
}

/** Write a manifest naming a session and a worktree, under an arbitrary directory. */
function manifest(dir: string, session: string, worktree: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ session, branch: 'feature/x', worktree, startedAt: '2026-08-25T10:00:00Z' }),
  );
  return file;
}

/** A same-origin POST carrying `body`. */
function request(body: unknown): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

/** A response that records rather than writes. */
function response(): { res: http.ServerResponse; got: Captured } {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
}

/** A liveness resolver that answers one fixed state for every worktree. */
function fixedLiveness(state: string): LivenessResolver {
  return (worktrees) => worktrees.map(() => state);
}

/** Run `handleDrop` with the given options and body, returning the captured response. */
async function drop(
  session: string,
  opts: Partial<DropOptions> & { repoRoot: string },
): Promise<Captured> {
  const { res, got } = response();
  const full: DropOptions = {
    repoRoot: opts.repoRoot,
    scriptsDir: opts.scriptsDir ?? SCRIPTS,
    host: opts.host ?? 'localhost',
    port: opts.port ?? 7777,
    // `finished` is droppable; injected so the test needs no live process.
    liveness: opts.liveness ?? fixedLiveness('finished'),
    manifestDir: opts.manifestDir,
  };
  await handleDrop(request({ session }), res, full);
  return got;
}

describe('drop removes the manifest the reader found — the configured directory, not the default', () => {
  it('item 7: resolves the directory through plot-config.sh and unlinks the file there', async () => {
    const root = repo();
    // The reader is pointed at a shared registry that is NOT `.plot/agents`.
    configFile(root, 'shared-registry');
    const file = manifest(path.join(root, 'shared-registry'), 'sess-cfg', '/wt/cfg');
    // Prove the bug's shape: the default directory is empty, so a drop that
    // joined the raw constant would find nothing and answer a false success.
    assert.ok(!fs.existsSync(path.join(root, AGENT_MANIFEST_DIR, 'sess-cfg.json')));

    const got = await drop('sess-cfg', { repoRoot: root });

    assert.equal(got.status, 200);
    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, true, 'the manifest was actually removed');
    assert.ok(!fs.existsSync(file), 'the file the reader found is gone');
  });

  it('item 8: a manifest in the configured dir is never answered "no manifest found"', async () => {
    // The sharper half. With the config pointing elsewhere and the file present
    // ONLY in the configured directory, the broken code looked at the default,
    // saw nothing, and reported `dropped=true` with "no manifest found" — over a
    // file that still existed. That answer is now unreachable: the endpoint reads
    // where the reader reads.
    const root = repo();
    configFile(root, 'shared-registry');
    const file = manifest(path.join(root, 'shared-registry'), 'sess-live', '/wt/live');
    // This entry is LIVE — so if the endpoint reads the right file, it must
    // REFUSE (not report a bogus success), and the file must survive.
    const got = await drop('sess-live', {
      repoRoot: root,
      liveness: fixedLiveness('running'),
    });

    assert.equal(got.status, 200);
    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, false, 'a live worker is refused, not falsely dropped');
    assert.match(body.reason, /running/, 'the refusal names the live state, not "no manifest found"');
    assert.ok(fs.existsSync(file), 'the reader\'s file is untouched by the refusal');
  });

  it('an explicit manifestDir seam bypasses the shell and is used for read and unlink alike', async () => {
    const root = repo();
    const elsewhere = path.join(root, 'somewhere-else');
    const file = manifest(elsewhere, 'sess-seam', '/wt/seam');

    const got = await drop('sess-seam', { repoRoot: root, manifestDir: elsewhere });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, true);
    assert.ok(!fs.existsSync(file), 'the unlink targeted the same directory the read did');
  });

  it('a single-checkout project with no key set still drops from .plot/agents', async () => {
    // Item 6's shape, applied to the write path: no config key, the default
    // `.plot/agents` is read and written, so today's behaviour is unchanged.
    const root = repo();
    const file = manifest(path.join(root, AGENT_MANIFEST_DIR), 'sess-default', '/wt/default');

    const got = await drop('sess-default', { repoRoot: root });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, true);
    assert.ok(!fs.existsSync(file), 'the default-path manifest is removed');
  });

  it('a genuinely absent manifest is an honest idempotent success', async () => {
    // The legitimate `dropped=true`: the reader's directory holds no such
    // session, so the entry was synthesized or already reaped. This is now
    // honest — it is the SAME directory the reader read, not a wrong-place look.
    const root = repo();
    configFile(root, 'shared-registry');
    fs.mkdirSync(path.join(root, 'shared-registry'), { recursive: true });

    const got = await drop('sess-missing', { repoRoot: root });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, true);
    assert.match(body.reason, /no manifest found/);
  });
});
