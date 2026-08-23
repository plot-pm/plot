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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseManifest, readAgentRegistry, AGENT_MANIFEST_DIR } from '../../src/server/registry.js';
import { projectSlug } from '../../src/server/transcript.js';

/** The real helper scripts, so the integration block can source the shell. */
const SCRIPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../skills/plot/scripts',
);

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
  it('carries no model from the MANIFEST — only from the transcript', () => {
    // Launch-time knowledge only. The dispatcher does not know the model; the
    // runtime chooses it, and a manifest that claimed one would be a guess.
    manifest('a.json', { session: 'y', model: 'invented', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.model, undefined);
  });
});

describe('the pid — a launch fact, read straight off the manifest', () => {
  // The manifest gained a pid so the registry can answer liveness once, in one
  // pass, without a per-entry worktree lookup. It is the AGENT's pid, written by
  // the wrapper the instant it learns its own child — the same value that lands
  // in `.plot-worker.pid`.
  it('carries the pid a modern dispatcher wrote', () => {
    manifest('a.json', { session: 'p', pid: '4242', worktree: '/wt/p',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.pid, '4242');
  });

  it('leaves the pid empty on an older manifest that has none', () => {
    // Absent is not a guess. An older dispatch wrote no pid; the entry says so
    // rather than inventing one.
    manifest('a.json', { session: 'q', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.pid, '');
  });

  it('refuses a non-numeric or zero pid, reading it as absent', () => {
    // `kill -0 0` signals the whole process group and succeeds, so a 0 would
    // read as running forever; junk cannot be a pid at all. Both are the same
    // answer a garbled `.plot-worker.pid` gets in plot-worker-state.sh.
    manifest('zero.json', { session: 'z', pid: '0', startedAt: '2026-08-20T10:00:00Z' });
    manifest('junk.json', { session: 'j', pid: 'not-a-pid', startedAt: '2026-08-20T09:00:00Z' });
    const got = readAgentRegistry(root, home);
    assert.equal(got.find((e) => e.session === 'z')?.pid, '');
    assert.equal(got.find((e) => e.session === 'j')?.pid, '');
  });
});

describe('the state — pulse-refreshed liveness, landing on the entry', () => {
  // The wave's reason for being. `plot-worker-state.sh` is the liveness check;
  // its answer lands on the entry instead of being re-derived by every caller.
  // The resolver is injected so these are deterministic — a live pid without
  // spawning one — and an integration test exercises the real shell below.

  /** A liveness resolver keyed on worktree, standing in for plot-worker-state.sh. */
  const fakeLiveness = (byWorktree: Record<string, string>) =>
    (worktrees: string[]): string[] => worktrees.map((wt) => byWorktree[wt] ?? 'unknown');

  it('reads `running` for an entry whose pid is alive', () => {
    manifest('a.json', { session: 'alive', pid: '4242', worktree: '/wt/alive',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { liveness: fakeLiveness({ '/wt/alive': 'running' }) });
    assert.equal(e.state, 'running');
  });

  it('reads `finished` for an entry whose pid is gone', () => {
    // The stale-manifest cure: the entry corrects itself on the next pulse,
    // with nobody deleting the file.
    manifest('a.json', { session: 'gone', pid: '4242', worktree: '/wt/gone',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { liveness: fakeLiveness({ '/wt/gone': 'finished' }) });
    assert.equal(e.state, 'finished');
  });

  it('keeps the waiting and stalled distinctions the shell already computes', () => {
    manifest('w.json', { session: 'w', pid: '11', worktree: '/wt/w',
      startedAt: '2026-08-20T10:00:00Z' });
    manifest('s.json', { session: 's', pid: '12', worktree: '/wt/s',
      startedAt: '2026-08-20T09:00:00Z' });
    const got = readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/w': 'waiting', '/wt/s': 'stalled' }),
    });
    assert.equal(got.find((e) => e.session === 'w')?.state, 'waiting');
    assert.equal(got.find((e) => e.session === 's')?.state, 'stalled');
  });

  it('CLASSIFIES an older manifest with no pid but a live worktree — the pid never gated the answer', () => {
    // Fix B. `plot-worker-state.sh` reads liveness from the WORKTREE — it is
    // handed the worktree path and reads `$wt/.plot-worker.pid` for itself — so
    // the manifest pid was never an input to the answer, only a ticket to be
    // asked the question. Gating on it skipped nine entries here that name a
    // worktree that exists and would have classified correctly. The entry must
    // now reach the resolver and take its answer.
    let asked: string[] = [];
    manifest('a.json', { session: 'old', worktree: '/wt/old',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, {
      liveness: (wts) => { asked = wts; return wts.map(() => 'running'); },
    });
    assert.equal(e.state, 'running', 'a pid-less entry with a worktree is classified');
    assert.deepEqual(asked, ['/wt/old'], 'and it IS asked about — the worktree is the only input');
  });

  it('reports `unknown` for an entry with a pid but no worktree to look in', () => {
    // The shell reads liveness from a worktree. An agent between branches holds
    // none, so there is nowhere to look — `unknown`, not a guess either way.
    manifest('a.json', { session: 'nowt', pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { liveness: fakeLiveness({}) });
    assert.equal(e.state, 'unknown');
  });

  it('defaults to `unknown` when no liveness resolver reaches an entry', () => {
    // The registry must never crash a read for want of a state. With the default
    // resolver unavailable to a bare call, every entry is at worst `unknown`.
    manifest('a.json', { session: 'x', pid: '4242', worktree: '/wt/x',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { liveness: () => { throw new Error('boom'); } });
    assert.equal(e.state, 'unknown');
  });

  it('counts the live entries in one pass — the cap asks every pulse', () => {
    // Derivable without a per-entry shell-out: the states are already on the
    // entries, so the cap is one filter over the array.
    manifest('a.json', { session: 'a', pid: '1', worktree: '/wt/a', startedAt: '2026-08-20T12:00:00Z' });
    manifest('b.json', { session: 'b', pid: '2', worktree: '/wt/b', startedAt: '2026-08-20T11:00:00Z' });
    manifest('c.json', { session: 'c', pid: '3', worktree: '/wt/c', startedAt: '2026-08-20T10:00:00Z' });
    const got = readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/a': 'running', '/wt/b': 'finished', '/wt/c': 'running' }),
    });
    assert.equal(got.filter((e) => e.state === 'running').length, 2);
  });
});

describe('liveness through the REAL plot-worker-state.sh — the reuse, proven', () => {
  // The unit tests inject a fake resolver; this one runs the actual shell the
  // brief requires the registry to reuse. A live pid must read `running`, a pid
  // that exited tidily `finished` — end to end, no reimplementation.
  let live: ReturnType<typeof spawn> | null = null;

  afterEach(() => {
    if (live && live.pid) {
      try { process.kill(live.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    live = null;
  });

  /** A worktree carrying a `.plot-worker.pid`, as the dispatcher leaves one. */
  function worktree(name: string, pid: number): string {
    const wt = path.join(root, name);
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(pid));
    return wt;
  }

  it('reads `running` for a worktree whose pid is genuinely alive', () => {
    // A real, live process — not a spawned assertion. `sleep 60` outlives the
    // test and is reaped in afterEach.
    live = spawn('sleep', ['60'], { stdio: 'ignore' });
    const pid = live.pid!;
    const wt = worktree('wt-live', pid);
    manifest('a.json', { session: 'live', pid: String(pid), worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'running');
  });

  it('reads `finished` for a worktree whose pid exited tidily', () => {
    // A pid that cannot be alive (nothing this high is running here), plus the
    // exit record the wrapper leaves on a clean exit: `plot_worker_state`
    // refines a clean exit with no PR and no work on the floor to `finished`.
    const wt = worktree('wt-done', 999999);
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '0');
    manifest('a.json', { session: 'done', pid: '999999', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'finished');
  });

  it('maps a shell state outside the four onto `unknown`', () => {
    // A dead pid with no exit record is `ended` to the shell — a real answer
    // about the process, but not one of the four the registry keeps. It becomes
    // `unknown` rather than being forced into `finished`: absent is not a guess.
    // This can only pass if the real shell was consulted; a stub could not
    // produce `ended`.
    const wt = worktree('wt-ended', 999998);
    manifest('a.json', { session: 'ended', pid: '999998', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'unknown');
  });

  it('stays `unknown` with no scriptsDir — lists the agent it cannot classify', () => {
    // The registry lists agents even where it cannot find the script. A bare
    // call (no resolver, no scriptsDir) never crashes and never guesses.
    const wt = worktree('wt-noscripts', 999997);
    manifest('a.json', { session: 'x', pid: '999997', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = readAgentRegistry(root, home);
    assert.equal(e.state, 'unknown');
    assert.equal(e.session, 'x', 'still listed');
  });
});
