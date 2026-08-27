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

describe('a GONE worktree is droppable; an unknown one that EXISTS is not', () => {
  // Items 5 and 5b. `classifyState` collapsed three unlike situations into
  // `unknown` — probe unrecognisable, resolver missing, worktree DELETED — and
  // only the first two mean "might be alive". Measured 2026-08-27: rows refused
  // with advice to "check the worktree manually", naming directories that had
  // been reaped and did not exist.
  //
  // Both directions are asserted, because a fix that simply drops every
  // `unknown` passes item 5 while discarding a running agent's record.

  it('item 5: an unknown entry whose worktree was deleted drops', async () => {
    const root = repo();
    configFile(root, 'shared-registry');
    // A path that is RECORDED and ABSENT — the reaped-worktree shape. This is
    // the case the old guard never asked about: it checked `!entry.worktree`
    // (no path at all) and never `existsSync` of a path it had.
    const gone = path.join(root, 'plot-wt-feature-reaped');
    const file = manifest(path.join(root, 'shared-registry'), 'sess-gone', gone);
    assert.ok(!fs.existsSync(gone), 'the fixture worktree must be absent');

    // Liveness cannot answer for a directory that is not there; that is exactly
    // how these entries reached `unknown` in production.
    const got = await drop('sess-gone', {
      repoRoot: root,
      liveness: fixedLiveness('unknown'),
    });

    assert.equal(got.status, 200);
    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, true, 'a worktree that does not exist runs nothing');
    assert.ok(!fs.existsSync(file), 'the stranded manifest is removed');
  });

  it('item 5b: an unknown entry whose worktree EXISTS is still refused', async () => {
    const root = repo();
    configFile(root, 'shared-registry');
    // The live-worker case the guard was written for: the state could not be
    // verified AND the directory is there, so it might hold a running agent.
    const present = path.join(root, 'plot-wt-feature-live');
    fs.mkdirSync(present, { recursive: true });
    const file = manifest(path.join(root, 'shared-registry'), 'sess-present', present);

    const got = await drop('sess-present', {
      repoRoot: root,
      liveness: fixedLiveness('unknown'),
    });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, false, 'unverifiable AND present must still refuse');
    assert.match(body.reason, /could not be verified/);
    assert.ok(fs.existsSync(file), 'the manifest survives a refusal');
  });

  it('an entry recording NO worktree path is still refused', async () => {
    // The pre-existing `!entry.worktree` case, unchanged. An agent between
    // checkouts records no path, and absence of a path is not absence of an
    // agent — so it must not be swept up by the gone-worktree widening.
    const root = repo();
    configFile(root, 'shared-registry');
    const file = manifest(path.join(root, 'shared-registry'), 'sess-nopath', '');

    const got = await drop('sess-nopath', {
      repoRoot: root,
      liveness: fixedLiveness('finished'),
    });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, false, 'no path recorded is not the same as no directory');
    assert.ok(fs.existsSync(file), 'the manifest survives');
  });

  it('a RUNNING worker whose worktree is gone is still refused as live', async () => {
    // Ordering guard. The live check runs BEFORE the gone check, so a resolver
    // that positively reports `running` outranks the directory's absence. A fix
    // that tested the worktree first would drop a live worker's record the
    // moment its path became unreadable.
    const root = repo();
    configFile(root, 'shared-registry');
    const gone = path.join(root, 'plot-wt-feature-vanished');
    const file = manifest(path.join(root, 'shared-registry'), 'sess-running', gone);

    const got = await drop('sess-running', {
      repoRoot: root,
      liveness: fixedLiveness('running'),
    });

    const body = got.body as unknown as DropResult;
    assert.equal(body.dropped, false, 'a positive running verdict outranks a missing directory');
    assert.match(body.reason, /still running/);
    assert.ok(fs.existsSync(file), 'the manifest survives');
  });
});
