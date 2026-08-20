// The agent registry: an identity that outlives the branch it was launched on.
//
// Three properties carry this file, and they are the wave's acceptance criteria.
// **An agent holding no branch is LISTED** — that is the state the registry
// exists for and the one no worktree can express. **The manifest records only
// launch-time knowledge**, so no field can be wrong about the past. And **a
// missing transcript costs fields, not entries**: the format is the runtime's
// private business and may change, so an entry that vanished with it would take
// the agent along.
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseManifest, readAgentRegistry, AGENT_MANIFEST_DIR } from '../../src/server/registry.js';
import { projectSlug } from '../../src/server/transcript.js';

let root = '';
let home = '';

/** A repo root with an agents directory, and a fake home for transcripts. */
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-registry-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-home-'));
  fs.mkdirSync(path.join(root, AGENT_MANIFEST_DIR), { recursive: true });
});
afterEach(() => {
  for (const d of [root, home]) fs.rmSync(d, { recursive: true, force: true });
});

function manifest(name: string, body: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, name), JSON.stringify(body));
}

/** A transcript where the runtime would put one for `cwd`, under our fake home. */
function transcript(cwd: string, session: string, lines: unknown[]): void {
  const dir = path.join(home, '.claude', 'projects', projectSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${session}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('parseManifest — the session id is the only requirement', () => {
  it('reads every launch-time field', () => {
    const e = parseManifest(JSON.stringify({
      session: 'aaa', branch: 'feature/x', worktree: '/wt',
      command: 'claude -p "go"', startedAt: '2026-08-20T09:00:00Z',
    }));
    assert.equal(e?.session, 'aaa');
    assert.equal(e?.branch, 'feature/x');
    assert.equal(e?.command, 'claude -p "go"');
    assert.equal(e?.startedAt, '2026-08-20T09:00:00Z');
  });

  it('rejects a manifest with no session — it names no agent', () => {
    // The key everything joins on. Defaulting it would invent an identity.
    assert.equal(parseManifest(JSON.stringify({ branch: 'feature/x' })), null);
    assert.equal(parseManifest(JSON.stringify({ session: '   ' })), null);
  });

  it('rejects what is not an object, without throwing', () => {
    for (const bad of ['', 'not json', '[]', 'null', '42']) {
      assert.equal(parseManifest(bad), null, `for ${JSON.stringify(bad)}`);
    }
  });

  it('defaults every other field rather than rejecting the entry', () => {
    // A manifest from an older dispatcher must still list its agent: an agent
    // nobody can see is one that gets restarted into work it already holds.
    const e = parseManifest(JSON.stringify({ session: 'bbb' }));
    assert.equal(e?.session, 'bbb');
    assert.equal(e?.branch, '');
    assert.equal(e?.command, '');
  });

  it('carries a command with quotes and newlines through unchanged', () => {
    // This repo's Worker command is ~1,500 characters of exactly this.
    const cmd = 'claude -p "line one\nline two \\"quoted\\"" --flag';
    const e = parseManifest(JSON.stringify({ session: 'ccc', command: cmd }));
    assert.equal(e?.command, cmd);
  });
});

describe('readAgentRegistry — an agent is not a branch', () => {
  it('LISTS an agent that holds no branch', () => {
    // The criterion this wave exists for. An empty branch is a real value, and
    // the entry must be present rather than omitted.
    manifest('a.json', { session: 'sess-a', branch: '', worktree: '/wt/a',
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    const got = readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].session, 'sess-a');
    assert.equal(got[0].branch, '');
  });

  it('returns [] when no dispatch has ever run', () => {
    fs.rmSync(path.join(root, AGENT_MANIFEST_DIR), { recursive: true, force: true });
    assert.deepEqual(readAgentRegistry(root, home), []);
  });

  it('skips a file that is not a manifest and keeps the ones that are', () => {
    manifest('good.json', { session: 'ok', startedAt: '2026-08-20T10:00:00Z' });
    fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, 'notes.txt'), 'ignored');
    const got = readAgentRegistry(root, home);
    assert.deepEqual(got.map((e) => e.session), ['ok']);
  });

  it('orders newest first, and an unknown time sorts LAST', () => {
    // An unknown launch time must not claim to be the most recent.
    manifest('old.json', { session: 'old', startedAt: '2026-08-19T10:00:00Z' });
    manifest('new.json', { session: 'new', startedAt: '2026-08-20T10:00:00Z' });
    manifest('none.json', { session: 'none' });
    assert.deepEqual(readAgentRegistry(root, home).map((e) => e.session),
      ['new', 'old', 'none']);
  });
});

describe('the transcript join — by exact session id, never by guess', () => {
  const facts = (session: string) => [
    { type: 'assistant', timestamp: '2026-08-20T11:00:00Z',
      message: { model: `model-for-${session}`, usage: { cache_read_input_tokens: 4242 } } },
  ];

  it('reads model, context and last activity from the named transcript', () => {
    const wt = '/tmp/wt-join';
    manifest('a.json', { session: 'exact', branch: 'feature/x', worktree: wt,
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    transcript(wt, 'exact', facts('exact'));
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.model, 'model-for-exact');
    assert.equal(e.contextTokens, 4242);
    assert.equal(e.lastActivity, '2026-08-20T11:00:00Z');
  });

  it('joins the NAMED session even when a newer transcript sits beside it', () => {
    // The guess this registry exists to remove: one worktree held eight
    // transcripts on 2026-08-20, so "the newest file" answers about whichever
    // run touched the disk last rather than about this agent.
    const wt = '/tmp/wt-many';
    manifest('a.json', { session: 'mine', worktree: wt, startedAt: '2026-08-20T10:00:00Z' });
    transcript(wt, 'mine', facts('mine'));
    transcript(wt, 'someone-else', facts('someone-else'));
    // Make the OTHER one newer on disk, so a newest-file join would take it.
    const dir = path.join(home, '.claude', 'projects', projectSlug(wt));
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(dir, 'someone-else.jsonl'), later, later);
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.model, 'model-for-mine');
  });

  it('costs FIELDS and not the entry when the transcript is absent', () => {
    manifest('a.json', { session: 'lonely', branch: 'feature/x', worktree: '/tmp/wt-gone',
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    const got = readAgentRegistry(root, home);
    assert.equal(got.length, 1, 'the agent is still listed');
    assert.equal(got[0].session, 'lonely');
    assert.equal(got[0].model, undefined);
    assert.equal(got[0].contextTokens, undefined);
  });

  it('costs FIELDS and not the entry when the transcript is unrecognised', () => {
    // Both directions asserted, because the format is private and may change.
    const wt = '/tmp/wt-weird';
    manifest('a.json', { session: 'odd', worktree: wt, startedAt: '2026-08-20T10:00:00Z' });
    transcript(wt, 'odd', [{ shape: 'nothing this board knows' }]);
    const got = readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].model, undefined);
  });

  it('has no transcript to join when the worktree is unknown', () => {
    manifest('a.json', { session: 'nowt', startedAt: '2026-08-20T10:00:00Z' });
    const got = readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].model, undefined);
  });
});

describe('what the registry deliberately does NOT record', () => {
  it('carries no pid — a pid describes the process, not the agent', () => {
    // Measured 2026-08-20: the panel showed pid=22516 for a worker gone hours
    // earlier. Liveness belongs to whatever is asking `ps` now, not to a record
    // of a launch.
    manifest('a.json', { session: 'x', pid: '12345', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal((e as Record<string, unknown>).pid, undefined);
  });

  it('carries no model from the MANIFEST — only from the transcript', () => {
    // Launch-time knowledge only. The dispatcher does not know the model; the
    // runtime chooses it, and a manifest that claimed one would be a guess.
    manifest('a.json', { session: 'y', model: 'invented', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.model, undefined);
  });
});
