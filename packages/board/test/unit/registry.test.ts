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

import {
  parseManifest, readAgentRegistry, gitWorktrees, AGENT_MANIFEST_DIR,
} from '../../src/server/registry.js';
import { execFileSync } from 'node:child_process';
import { AgentStateSchema as DomainAgentStateSchema } from '@plot-pm/domain';
import { projectSlug } from '../../src/server/transcript.js';
import { rmTree } from '../helpers.mjs';

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
  for (const d of [root, home]) rmTree(d);
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
  it('reads every launch-time field', async () => {
    const e = parseManifest(JSON.stringify({
      session: 'aaa', branch: 'feature/x', worktree: '/wt',
      command: 'claude -p "go"', startedAt: '2026-08-20T09:00:00Z',
    }));
    assert.equal(e?.session, 'aaa');
    assert.equal(e?.branch, 'feature/x');
    assert.equal(e?.command, 'claude -p "go"');
    assert.equal(e?.startedAt, '2026-08-20T09:00:00Z');
  });

  it('rejects a manifest with no session — it names no agent', async () => {
    // The key everything joins on. Defaulting it would invent an identity.
    assert.equal(parseManifest(JSON.stringify({ branch: 'feature/x' })), null);
    assert.equal(parseManifest(JSON.stringify({ session: '   ' })), null);
  });

  it('rejects what is not an object, without throwing', async () => {
    for (const bad of ['', 'not json', '[]', 'null', '42']) {
      assert.equal(parseManifest(bad), null, `for ${JSON.stringify(bad)}`);
    }
  });

  it('defaults every other field rather than rejecting the entry', async () => {
    // A manifest from an older dispatcher must still list its agent: an agent
    // nobody can see is one that gets restarted into work it already holds.
    const e = parseManifest(JSON.stringify({ session: 'bbb' }));
    assert.equal(e?.session, 'bbb');
    assert.equal(e?.branch, '');
    assert.equal(e?.command, '');
  });

  it('carries a command with quotes and newlines through unchanged', async () => {
    // This repo's Worker command is ~1,500 characters of exactly this.
    const cmd = 'claude -p "line one\nline two \\"quoted\\"" --flag';
    const e = parseManifest(JSON.stringify({ session: 'ccc', command: cmd }));
    assert.equal(e?.command, cmd);
  });
});

describe('readAgentRegistry — an agent is not a branch', () => {
  it('LISTS an agent that holds no branch', async () => {
    // The criterion this wave exists for. An empty branch is a real value, and
    // the entry must be present rather than omitted.
    manifest('a.json', { session: 'sess-a', branch: '', worktree: '/wt/a',
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].session, 'sess-a');
    assert.equal(got[0].branch, '');
  });

  it('returns [] when no dispatch has ever run', async () => {
    rmTree(path.join(root, AGENT_MANIFEST_DIR));
    assert.deepEqual(await readAgentRegistry(root, home), []);
  });

  it('skips a file that is not a manifest and keeps the ones that are', async () => {
    manifest('good.json', { session: 'ok', startedAt: '2026-08-20T10:00:00Z' });
    fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, 'notes.txt'), 'ignored');
    const got = await readAgentRegistry(root, home);
    assert.deepEqual(got.map((e) => e.session), ['ok']);
  });

  it('orders newest first, and an unknown time sorts LAST', async () => {
    // An unknown launch time must not claim to be the most recent.
    manifest('old.json', { session: 'old', startedAt: '2026-08-19T10:00:00Z' });
    manifest('new.json', { session: 'new', startedAt: '2026-08-20T10:00:00Z' });
    manifest('none.json', { session: 'none' });
    assert.deepEqual((await readAgentRegistry(root, home)).map((e) => e.session),
      ['new', 'old', 'none']);
  });
});

describe('the transcript join — by exact session id, never by guess', () => {
  const facts = (session: string) => [
    { type: 'assistant', timestamp: '2026-08-20T11:00:00Z',
      message: { model: `model-for-${session}`, usage: { cache_read_input_tokens: 4242 } } },
  ];

  it('reads model, context and last activity from the named transcript', async () => {
    const wt = '/tmp/wt-join';
    manifest('a.json', { session: 'exact', branch: 'feature/x', worktree: wt,
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    transcript(wt, 'exact', facts('exact'));
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.model, 'model-for-exact');
    assert.equal(e.contextTokens, 4242);
    assert.equal(e.lastActivity, '2026-08-20T11:00:00Z');
  });

  it('joins the NAMED session even when a newer transcript sits beside it', async () => {
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
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.model, 'model-for-mine');
  });

  it('costs FIELDS and not the entry when the transcript is absent', async () => {
    manifest('a.json', { session: 'lonely', branch: 'feature/x', worktree: '/tmp/wt-gone',
      command: 'claude', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home);
    assert.equal(got.length, 1, 'the agent is still listed');
    assert.equal(got[0].session, 'lonely');
    assert.equal(got[0].model, undefined);
    assert.equal(got[0].contextTokens, undefined);
  });

  it('costs FIELDS and not the entry when the transcript is unrecognised', async () => {
    // Both directions asserted, because the format is private and may change.
    const wt = '/tmp/wt-weird';
    manifest('a.json', { session: 'odd', worktree: wt, startedAt: '2026-08-20T10:00:00Z' });
    transcript(wt, 'odd', [{ shape: 'nothing this board knows' }]);
    const got = await readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].model, undefined);
  });

  it('has no transcript to join when the worktree is unknown', async () => {
    manifest('a.json', { session: 'nowt', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home);
    assert.equal(got.length, 1);
    assert.equal(got[0].model, undefined);
  });
});

describe('what the registry deliberately does NOT record', () => {
  it('carries no model from the MANIFEST — only from the transcript', async () => {
    // Launch-time knowledge only. The dispatcher does not know the model; the
    // runtime chooses it, and a manifest that claimed one would be a guess.
    manifest('a.json', { session: 'y', model: 'invented', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.model, undefined);
  });
});

describe('the pid — a launch fact, read straight off the manifest', () => {
  // The manifest gained a pid so the registry can answer liveness once, in one
  // pass, without a per-entry worktree lookup. It is the AGENT's pid, written by
  // the wrapper the instant it learns its own child — the same value that lands
  // in `.plot-worker.pid`.
  it('carries the pid a modern dispatcher wrote', async () => {
    manifest('a.json', { session: 'p', pid: '4242', worktree: '/wt/p',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.pid, '4242');
  });

  it('leaves the pid empty on an older manifest that has none', async () => {
    // Absent is not a guess. An older dispatch wrote no pid; the entry says so
    // rather than inventing one.
    manifest('a.json', { session: 'q', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.pid, '');
  });

  it('refuses a non-numeric or zero pid, reading it as absent', async () => {
    // `kill -0 0` signals the whole process group and succeeds, so a 0 would
    // read as running forever; junk cannot be a pid at all. Both are the same
    // answer a garbled `.plot-worker.pid` gets in plot-worker-state.sh.
    manifest('zero.json', { session: 'z', pid: '0', startedAt: '2026-08-20T10:00:00Z' });
    manifest('junk.json', { session: 'j', pid: 'not-a-pid', startedAt: '2026-08-20T09:00:00Z' });
    const got = await readAgentRegistry(root, home);
    assert.equal(got.find((e) => e.session === 'z')?.pid, '');
    assert.equal(got.find((e) => e.session === 'j')?.pid, '');
  });
});

describe('the process group — every process the registry started, not just one', () => {
  // The defect: the manifest recorded the agent and nothing else, so the wrapper
  // and both monitors were nameable from nowhere. Measured on the estate
  // 2026-08-30 — 1 manifest, 76 monitor processes, 0 of them nameable.
  //
  //   plot-dispatch.sh  (7357)
  //     └── wrapper     (7358)             ← in no manifest
  //           ├── WorkerMonitor    (7364)  ← in no manifest
  //           ├── AgentMonitor     (7365)  ← in no manifest
  //           └── plot-worker-loop (7366)  ← "pid": "7366"
  it('carries the wrapper and both monitors a modern dispatcher wrote', async () => {
    manifest('a.json', {
      session: 'g', pid: '7366', worktree: '/wt/g', startedAt: '2026-08-20T10:00:00Z',
      wrapperPid: '7358', workerMonitorPid: '7364', agentMonitorPid: '7365',
      buildMonitorPid: '7367',
    });
    const [e] = await readAgentRegistry(root, home);
    assert.deepEqual(e.group, {
      wrapperPid: '7358', workerMonitorPid: '7364', agentMonitorPid: '7365',
      buildMonitorPid: '7367',
    });
  });

  // THE CONTRACT THE BRIEF NAMES: an old manifest still parses, and reports the
  // group as UNKNOWN rather than EMPTY. `undefined` is that unknown; a group of
  // three empty strings would be the different, false claim that this dispatch
  // started nothing beside its agent.
  it('reports UNKNOWN, not empty, on a manifest written before the field', async () => {
    manifest('a.json', { session: 'old', pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.group, undefined,
      'a manifest that cannot say what it started must not claim it started nothing');
    assert.equal(e.pid, '4242', 'and the rest of the entry still parses');
  });

  // The other side of the same distinction: a dispatch that attached NO monitor
  // did say so, and `''` is that answer. A hand-made worktree gets no monitors.
  it('distinguishes a member never started (empty) from the whole group unknown', async () => {
    manifest('a.json', {
      session: 'nomon', pid: '10', startedAt: '2026-08-20T10:00:00Z',
      wrapperPid: '11', workerMonitorPid: '', agentMonitorPid: '', buildMonitorPid: '',
    });
    const [e] = await readAgentRegistry(root, home);
    assert.notEqual(e.group, undefined, 'the group IS known — the manifest carries it');
    assert.equal(e.group?.wrapperPid, '11');
    assert.equal(e.group?.workerMonitorPid, '', 'empty means this one was never started');
  });

  // A PARTIAL group is still a known group. The presence of ANY member is what
  // makes the manifest one that speaks about its group at all.
  it('reads a partial group as known, with the missing members empty', async () => {
    manifest('a.json', {
      session: 'part', pid: '10', startedAt: '2026-08-20T10:00:00Z', wrapperPid: '11',
    });
    const [e] = await readAgentRegistry(root, home);
    assert.deepEqual(e.group,
      { wrapperPid: '11', workerMonitorPid: '', agentMonitorPid: '', buildMonitorPid: '' });
  });

  it('refuses a zero or non-numeric member, reading it as never started', async () => {
    // Same rule the pid follows: `kill -0 0` signals the whole process group and
    // succeeds, so a 0 here would send a reader to check the wrong thing.
    manifest('a.json', {
      session: 'bad', pid: '10', startedAt: '2026-08-20T10:00:00Z',
      wrapperPid: '0', workerMonitorPid: 'not-a-pid', agentMonitorPid: '7365',
    });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.group?.wrapperPid, '');
    assert.equal(e.group?.workerMonitorPid, '');
    assert.equal(e.group?.agentMonitorPid, '7365', 'a good member survives a bad sibling');
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

  it('reads `running` for an entry whose pid is alive', async () => {
    manifest('a.json', { session: 'alive', pid: '4242', worktree: '/wt/alive',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { liveness: fakeLiveness({ '/wt/alive': 'running' }) });
    assert.equal(e.state, 'running');
  });

  it('reads `finished` for an entry whose pid is gone', async () => {
    // The stale-manifest cure: the entry corrects itself on the next pulse,
    // with nobody deleting the file.
    manifest('a.json', { session: 'gone', pid: '4242', worktree: '/wt/gone',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { liveness: fakeLiveness({ '/wt/gone': 'finished' }) });
    assert.equal(e.state, 'finished');
  });

  it('keeps the waiting and stalled distinctions the shell already computes', async () => {
    manifest('w.json', { session: 'w', pid: '11', worktree: '/wt/w',
      startedAt: '2026-08-20T10:00:00Z' });
    manifest('s.json', { session: 's', pid: '12', worktree: '/wt/s',
      startedAt: '2026-08-20T09:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/w': 'waiting', '/wt/s': 'stalled' }),
    });
    assert.equal(got.find((e) => e.session === 'w')?.state, 'waiting');
    assert.equal(got.find((e) => e.session === 's')?.state, 'stalled');
  });

  it('CLASSIFIES an older manifest with no pid but a live worktree — the pid never gated the answer', async () => {
    // Fix B. `plot-worker-state.sh` reads liveness from the WORKTREE — it is
    // handed the worktree path and reads `$wt/.plot-worker.pid` for itself — so
    // the manifest pid was never an input to the answer, only a ticket to be
    // asked the question. Gating on it skipped nine entries here that name a
    // worktree that exists and would have classified correctly. The entry must
    // now reach the resolver and take its answer.
    let asked: string[] = [];
    manifest('a.json', { session: 'old', worktree: '/wt/old',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, {
      liveness: (wts) => { asked = wts; return wts.map(() => 'running'); },
    });
    assert.equal(e.state, 'running', 'a pid-less entry with a worktree is classified');
    assert.deepEqual(asked, ['/wt/old'], 'and it IS asked about — the worktree is the only input');
  });

  it('carries every one of the eight shell answers through unchanged', async () => {
    // ONE AGENT READS ONE STATE — the wave's assertion, stated over the whole
    // shell vocabulary. `KNOWN_STATES` folded `failed`, `ended`, `none` and
    // `elsewhere` into `unknown` until 2026-09-04, so a `failed` agent and an
    // agent nobody had looked at were the same word on the board. Asserted over
    // the domain enum so the shell, the domain and the registry cannot drift to
    // three vocabularies again — which is what `DESIGN-agent.md:797` recorded.
    const shellStates = DomainAgentStateSchema.options;
    assert.equal(shellStates.length, 8);
    const byWorktree: Record<string, string> = {};
    shellStates.forEach((state, i) => {
      manifest(`${i}.json`, { session: state, pid: String(100 + i), worktree: `/wt/${state}`,
        startedAt: `2026-08-20T${String(10 + i).padStart(2, '0')}:00:00Z` });
      byWorktree[`/wt/${state}`] = state;
    });
    const got = await readAgentRegistry(root, home, { liveness: fakeLiveness(byWorktree) });
    for (const state of shellStates) {
      assert.equal(got.find((e) => e.session === state)?.state, state, state);
    }
  });

  it('still refuses a state the shell could never print', async () => {
    // The widening is to the EIGHT the shell answers, not to anything a resolver
    // hands back. A word outside the vocabulary is `unknown` — the same
    // not-a-guess answer a check that could not run gets.
    manifest('a.json', { session: 'rogue', pid: '4242', worktree: '/wt/rogue',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { liveness: fakeLiveness({ '/wt/rogue': 'queued' }) });
    assert.equal(e.state, 'unknown');
  });

  it('reports `unknown` for an entry with a pid but no worktree to look in', async () => {
    // The shell reads liveness from a worktree. An agent between branches holds
    // none, so there is nowhere to look — `unknown`, not a guess either way.
    manifest('a.json', { session: 'nowt', pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { liveness: fakeLiveness({}) });
    assert.equal(e.state, 'unknown');
  });

  it('defaults to `unknown` when no liveness resolver reaches an entry', async () => {
    // The registry must never crash a read for want of a state. With the default
    // resolver unavailable to a bare call, every entry is at worst `unknown`.
    manifest('a.json', { session: 'x', pid: '4242', worktree: '/wt/x',
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { liveness: () => { throw new Error('boom'); } });
    assert.equal(e.state, 'unknown');
  });

  it('counts the live entries in one pass — the cap asks every pulse', async () => {
    // Derivable without a per-entry shell-out: the states are already on the
    // entries, so the cap is one filter over the array.
    manifest('a.json', { session: 'a', pid: '1', worktree: '/wt/a', startedAt: '2026-08-20T12:00:00Z' });
    manifest('b.json', { session: 'b', pid: '2', worktree: '/wt/b', startedAt: '2026-08-20T11:00:00Z' });
    manifest('c.json', { session: 'c', pid: '3', worktree: '/wt/c', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/a': 'running', '/wt/b': 'finished', '/wt/c': 'running' }),
    });
    assert.equal(got.filter((e) => e.state === 'running').length, 2);
  });
});

describe('a worktree with no manifest is listed — absence of a record is not absence of an agent', () => {
  // Fix C. The registry cannot tell WHY a manifest is absent — a pre-registry
  // dispatch, a manifest deleted by hand, a worktree made outside the dispatcher,
  // a failed write — and only one of those means no agent was ever here. So a
  // worktree it can see and cannot rule out is synthesized as an entry rather
  // than dropped. This does not rescue a live agent today; it prevents a class.

  /** A worktree enumerator standing in for `git worktree list --porcelain`. */
  const worktrees = (list: { path: string; branch: string; isMain?: boolean }[]) =>
    () => list.map((w) => ({ ...w, isMain: w.isMain ?? false }));

  const fakeLiveness = (byWorktree: Record<string, string>) =>
    (wts: string[]): string[] => wts.map((wt) => byWorktree[wt] ?? 'unknown');

  it('synthesizes an entry for a worktree no manifest names, carrying its branch and a real state', async () => {
    // No manifests at all, one real worktree — the shape three of the six
    // measured here have (a .plot-worker.pid, no manifest).
    const got = await readAgentRegistry(root, home, {
      worktrees: worktrees([{ path: '/wt/orphan', branch: 'feature/orphan' }]),
      liveness: fakeLiveness({ '/wt/orphan': 'waiting' }),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].worktree, '/wt/orphan');
    assert.equal(got[0].branch, 'feature/orphan');
    assert.equal(got[0].state, 'waiting', 'classified like any other entry');
  });

  it('gives a synthesized entry session="" and no invented command or startedAt', async () => {
    // A synthesized entry must not invent launch facts it does not have. `session`
    // is minted at launch and this worktree has none; a startedAt guessed from
    // mtime would read as a launch record and be false.
    const [e] = await readAgentRegistry(root, home, {
      worktrees: worktrees([{ path: '/wt/orphan', branch: 'feature/orphan' }]),
      liveness: fakeLiveness({ '/wt/orphan': 'running' }),
    });
    assert.equal(e.session, '', 'no launch id was ever minted');
    assert.equal(e.command, '', 'no command to record');
    assert.equal(e.startedAt, '', 'a guessed start time would be a false launch record');
    assert.equal(e.model, undefined, 'transcript fields absent, not guessed');
    assert.equal(e.contextTokens, undefined);
  });

  it('does NOT render the main repo as an agent', async () => {
    // `git worktree list` includes the primary checkout; it is not an agent.
    const got = await readAgentRegistry(root, home, {
      worktrees: worktrees([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/wt/real', branch: 'feature/real' },
      ]),
      liveness: fakeLiveness({ '/wt/real': 'running' }),
    });
    assert.deepEqual(got.map((e) => e.worktree), ['/wt/real'], 'the main repo is excluded');
  });

  it('does NOT render a branchless worktree as an agent', async () => {
    // A detached or unreadable HEAD has nothing an agent row could be about —
    // the scratch dirs wt-gate3 and plot-wt-folded-plan measured here.
    const got = await readAgentRegistry(root, home, {
      worktrees: worktrees([
        { path: '/wt/real', branch: 'feature/real' },
        { path: '/wt/scratch', branch: '' },
      ]),
      liveness: fakeLiveness({ '/wt/real': 'running', '/wt/scratch': 'running' }),
    });
    assert.deepEqual(got.map((e) => e.worktree), ['/wt/real'], 'the branchless worktree is excluded');
  });

  it('does NOT synthesize where a manifest already names the worktree — no worktree appears twice', async () => {
    // Precedence: a manifest wins. The worktree it names is not synthesized again.
    manifest('a.json', { session: 'has-manifest', branch: 'feature/known',
      worktree: '/wt/known', pid: '42', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      worktrees: worktrees([
        { path: '/wt/known', branch: 'feature/known' },
        { path: '/wt/new', branch: 'feature/new' },
      ]),
      liveness: fakeLiveness({ '/wt/known': 'running', '/wt/new': 'waiting' }),
    });
    const known = got.filter((e) => e.worktree === '/wt/known');
    assert.equal(known.length, 1, 'the worktree appears once');
    assert.equal(known[0].session, 'has-manifest', 'and it is the manifest entry, not a synthesized one');
    assert.equal(got.length, 2, 'the manifest entry plus the one synthesized worktree');
  });

  it('lists nothing extra when every worktree already has a manifest', async () => {
    manifest('a.json', { session: 's', branch: 'feature/x', worktree: '/wt/x',
      pid: '42', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      worktrees: worktrees([{ path: '/wt/x', branch: 'feature/x' }]),
      liveness: fakeLiveness({ '/wt/x': 'running' }),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].session, 's');
  });
});

describe('the manifest directory is configured — the registry lives where the dispatcher writes it', () => {
  // The wave's reason for being. `.plot/agents/` is gitignored, so it is
  // per-worktree; a board served from a worktree the dispatcher never wrote to
  // reads an empty directory and synthesizes the whole fleet with `session: ''`.
  // Resolving the directory through `plot-config.sh` — with today's path as the
  // default — lets a board find the dispatcher's registry wherever it was
  // started from, while a single-checkout project sees no change at all.

  /** A worktree enumerator standing in for `git worktree list --porcelain`. */
  const worktrees = (list: { path: string; branch: string; isMain?: boolean }[]) =>
    () => list.map((w) => ({ ...w, isMain: w.isMain ?? false }));

  /** Write a `CLAUDE.md` at `root` declaring one Plot Config key. */
  function configFile(key: string, value: string): void {
    fs.writeFileSync(
      path.join(root, 'CLAUDE.md'),
      `# Repo\n\n## Plot Config\n\n- **${key}:** \`${value}\`\n`,
    );
  }

  it('reads manifests from an explicit manifestDir, and the session id survives', async () => {
    // Item 1. The test seam: an already-resolved directory bypasses the shell.
    // A manifest-backed entry carries its session — the identity a synthesized
    // row cannot — so `BrokenAgentMenu` can offer *Drop this agent*.
    const elsewhere = path.join(root, 'dispatched');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(
      path.join(elsewhere, 'a.json'),
      JSON.stringify({ session: 'sess-a', branch: 'feature/x', worktree: '/wt/a',
        command: 'claude', startedAt: '2026-08-20T10:00:00Z' }),
    );
    const got = await readAgentRegistry(root, home, { manifestDir: elsewhere });
    assert.equal(got.length, 1);
    assert.equal(got[0].session, 'sess-a', 'the session id is not lost');
  });

  it('resolves the directory through plot-config.sh when a key is set', async () => {
    // Item 1, end to end through the real shell: the board reads the key the
    // adopting project declares, and finds the dispatcher's manifests there.
    const elsewhere = path.join(root, 'shared-registry');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.writeFileSync(
      path.join(elsewhere, 'a.json'),
      JSON.stringify({ session: 'sess-cfg', worktree: '/wt/cfg',
        startedAt: '2026-08-20T10:00:00Z' }),
    );
    configFile('Agent registry', 'shared-registry');
    const got = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(got.map((e) => e.session), ['sess-cfg']);
  });

  it('a project with no config key set behaves exactly as today', async () => {
    // Item 6. This is the assertion a fix-this-estate-break-every-other-adopter
    // change fails: with no key, the default `.plot/agents` is read, and the
    // manifest written there in `beforeEach`'s directory is found.
    fs.writeFileSync(
      path.join(root, AGENT_MANIFEST_DIR, 'a.json'),
      JSON.stringify({ session: 'default-path', startedAt: '2026-08-20T10:00:00Z' }),
    );
    // No CLAUDE.md, but scriptsDir IS present — proving the shell resolves to the
    // default rather than the change only working when the shell is absent.
    const got = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.deepEqual(got.map((e) => e.session), ['default-path']);
  });

  it('falls back to the default path with no scriptsDir and no override — no shell-out', async () => {
    // A bare call resolves to `.plot/agents` without shelling out at all, the
    // same graceful degradation every other injected resolver follows.
    fs.writeFileSync(
      path.join(root, AGENT_MANIFEST_DIR, 'a.json'),
      JSON.stringify({ session: 'bare', startedAt: '2026-08-20T10:00:00Z' }),
    );
    const got = await readAgentRegistry(root, home);
    assert.deepEqual(got.map((e) => e.session), ['bare']);
  });

  it('a worktree that genuinely has no manifest still synthesizes an entry with session=""', async () => {
    // Item 2. The synthesis path is NOT removed by pointing the reader elsewhere.
    // The resolved directory is empty, so a hand-made worktree is still visible —
    // with `session: ''`, which is what a naive implementation that deleted the
    // fallback would make vanish.
    const empty = path.join(root, 'empty-registry');
    fs.mkdirSync(empty, { recursive: true });
    const got = await readAgentRegistry(root, home, {
      manifestDir: empty,
      worktrees: worktrees([{ path: '/wt/orphan', branch: 'feature/orphan' }]),
      liveness: (wts) => wts.map(() => 'running'),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].worktree, '/wt/orphan');
    assert.equal(got[0].session, '', 'synthesized, session empty by design');
  });

  it('an absent configured directory reads as no dispatch, and synthesis still runs', async () => {
    // The configured directory does not exist yet (no dispatch has written to it).
    // That is the empty-directory case, not a throw: synthesis proceeds.
    const got = await readAgentRegistry(root, home, {
      manifestDir: path.join(root, 'never-created'),
      worktrees: worktrees([{ path: '/wt/orphan', branch: 'feature/orphan' }]),
      liveness: (wts) => wts.map(() => 'waiting'),
    });
    assert.equal(got.length, 1);
    assert.equal(got[0].session, '');
    assert.equal(got[0].state, 'waiting');
  });
});

describe('gitWorktrees — the real porcelain, parsed', () => {
  // The default lister runs `git worktree list --porcelain`; this proves it
  // against real git output rather than a hand-written fixture, so a change to
  // the porcelain format fails here rather than silently in production.
  let repo = '';
  afterEach(() => {
    if (repo) rmTree(repo);
    repo = '';
  });

  it('marks the primary checkout isMain, names branches, and leaves a detached worktree branchless', async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitwt-'));
    const main = path.join(repo, 'main');
    const g = (dir: string, ...a: string[]) =>
      execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    execFileSync('git', ['init', '-q', '-b', 'main', main], { stdio: 'ignore' });
    g(main, 'config', 'user.email', 't@e.x');
    g(main, 'config', 'user.name', 'T');
    g(main, 'commit', '-q', '--allow-empty', '-m', 'root');
    // A second worktree ON A BRANCH, and a third DETACHED at a commit.
    g(main, 'branch', 'feature/side');
    g(main, 'worktree', 'add', '-q', path.join(repo, 'side'), 'feature/side');
    g(main, 'worktree', 'add', '-q', '--detach', path.join(repo, 'loose'), 'HEAD');

    const got = await gitWorktrees(main);
    const primary = got.find((w) => w.path === fs.realpathSync(main));
    const side = got.find((w) => w.branch === 'feature/side');
    const loose = got.find((w) => w.path === fs.realpathSync(path.join(repo, 'loose')));

    assert.ok(primary?.isMain, 'the primary checkout is flagged isMain');
    assert.equal(side?.isMain, false, 'a linked worktree is not the main repo');
    assert.equal(side?.branch, 'feature/side', 'refs/heads/ is stripped to the branch name');
    assert.equal(loose?.branch, '', 'a detached worktree carries no branch');
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

  it('reads `running` for a worktree whose pid is genuinely alive', async () => {
    // A real, live process — not a spawned assertion. `sleep 60` outlives the
    // test and is reaped in afterEach.
    live = spawn('sleep', ['60'], { stdio: 'ignore' });
    const pid = live.pid!;
    const wt = worktree('wt-live', pid);
    manifest('a.json', { session: 'live', pid: String(pid), worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'running');
  });

  it('reads `finished` for a worktree whose pid exited tidily', async () => {
    // A pid that cannot be alive (nothing this high is running here), plus the
    // exit record the wrapper leaves on a clean exit: `plot_worker_state`
    // refines a clean exit with no PR and no work on the floor to `finished`.
    const wt = worktree('wt-done', 999999);
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '0');
    manifest('a.json', { session: 'done', pid: '999999', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'finished');
  });

  it('reads `ended` from the shell rather than folding it into `unknown`', async () => {
    // THE COLLAPSE, MEASURED THROUGH THE REAL SHELL. A dead pid with no exit
    // record is `ended` — a specific answer about the process — and the registry
    // discarded it into `unknown` until 2026-09-04, alongside `failed`, `none`
    // and `elsewhere`. `unknown` means *nobody looked*; the shell looked and
    // answered. This can only pass if the real shell was consulted; a stub could
    // not produce `ended`.
    const wt = worktree('wt-ended', 999998);
    manifest('a.json', { session: 'ended', pid: '999998', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'ended');
  });

  it('reads `failed` from the shell — a recorded non-zero exit is not a guess', async () => {
    // The wrapper's exit record says 3. `plot_worker_state` does not refine
    // `failed` by the tree, so this is the process's own report and the registry
    // carries it verbatim. Under the five-state enum it read `unknown`, which
    // sent a reader looking for evidence the desk already held.
    const wt = worktree('wt-failed', 999996);
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), '3');
    manifest('a.json', { session: 'failed', pid: '999996', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home, { scriptsDir: SCRIPTS_DIR });
    assert.equal(e.state, 'failed');
  });

  it('stays `unknown` with no scriptsDir — lists the agent it cannot classify', async () => {
    // The registry lists agents even where it cannot find the script. A bare
    // call (no resolver, no scriptsDir) never crashes and never guesses.
    const wt = worktree('wt-noscripts', 999997);
    manifest('a.json', { session: 'x', pid: '999997', worktree: wt,
      startedAt: '2026-08-20T10:00:00Z' });
    const [e] = await readAgentRegistry(root, home);
    assert.equal(e.state, 'unknown');
    assert.equal(e.session, 'x', 'still listed');
  });
});

describe('dropping settled workers — only when BOTH conditions hold', () => {
  // An entry is dropped only when:
  // 1. The session has ended (state is NOT `running`)
  // 2. The worktree is clean (no uncommitted AND no unpushed)
  //
  // Either condition outstanding and the entry stays visible. A worker with a
  // dirty worktree and an ended session is still reported with what it is
  // holding; a worker with a clean worktree and a live session is still working.
  // Only a worker with nothing outstanding disappears.

  /** A liveness resolver keyed on worktree. */
  const fakeLiveness = (byWorktree: Record<string, string>) =>
    (worktrees: string[]): string[] => worktrees.map((wt) => byWorktree[wt] ?? 'unknown');

  /** A cleanliness resolver keyed on worktree. */
  const fakeCleanliness = (byWorktree: Record<string, boolean>) =>
    (worktrees: string[]): boolean[] => worktrees.map((wt) => byWorktree[wt] ?? false);

  it('KEEPS a worker with a dirty worktree and an ended session — uncommitted work outstanding', async () => {
    // Done when #7: A worker with a dirty worktree and an ended session is still
    // reported, with what it is holding.
    manifest('a.json', { session: 'dirty-ended', pid: '4242', worktree: '/wt/dirty',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/dirty': 'finished' }),
      cleanliness: fakeCleanliness({ '/wt/dirty': false }), // dirty
    });
    assert.equal(got.length, 1, 'the entry is kept');
    assert.equal(got[0].session, 'dirty-ended');
    assert.equal(got[0].state, 'finished');
  });

  it('KEEPS a worker with a clean worktree and a live session — still running', async () => {
    // Done when #8: A worker with a clean worktree and a live session is still
    // reported.
    manifest('a.json', { session: 'clean-running', pid: '4242', worktree: '/wt/clean',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/clean': 'running' }),
      cleanliness: fakeCleanliness({ '/wt/clean': true }), // clean — but running
    });
    assert.equal(got.length, 1, 'the entry is kept');
    assert.equal(got[0].session, 'clean-running');
    assert.equal(got[0].state, 'running');
  });

  it('DROPS a worker with a clean worktree and an ended session — nothing outstanding', async () => {
    // Done when #9: A worker with a clean worktree and an ended session is absent.
    manifest('a.json', { session: 'clean-ended', pid: '4242', worktree: '/wt/clean',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/clean': 'finished' }),
      cleanliness: fakeCleanliness({ '/wt/clean': true }), // clean AND ended
    });
    assert.equal(got.length, 0, 'the entry is dropped');
  });

  it('KEEPS an entry with no worktree — nothing to check', async () => {
    // "Absent is not false": an entry with no worktree cannot be checked for
    // cleanliness, so it stays visible regardless of state.
    manifest('a.json', { session: 'no-wt', startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({}), // unknown state
      cleanliness: fakeCleanliness({}),
    });
    assert.equal(got.length, 1, 'the entry is kept');
    assert.equal(got[0].session, 'no-wt');
  });

  it('distinguishes ended states — only `running` is a live session', async () => {
    // All non-running states represent an ended session: finished, waiting,
    // stalled, unknown. Each should be dropped when clean.
    for (const state of ['finished', 'waiting', 'stalled', 'unknown'] as const) {
      const wt = `/wt/${state}`;
      manifest(`${state}.json`, { session: state, pid: '4242', worktree: wt,
        startedAt: '2026-08-20T10:00:00Z' });
    }
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({
        '/wt/finished': 'finished',
        '/wt/waiting': 'waiting',
        '/wt/stalled': 'stalled',
        '/wt/unknown': 'unknown',
      }),
      cleanliness: fakeCleanliness({
        '/wt/finished': true,
        '/wt/waiting': true,
        '/wt/stalled': true,
        '/wt/unknown': true,
      }),
    });
    assert.equal(got.length, 0, 'all ended+clean entries are dropped');
  });

  it('keeps entries when cleanliness resolver throws — fail open', async () => {
    // If the cleanliness check fails, we keep all entries rather than dropping
    // any. An entry invisible during an outage is one that gets overlooked.
    manifest('a.json', { session: 'x', pid: '4242', worktree: '/wt/x',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/x': 'finished' }),
      cleanliness: () => { throw new Error('boom'); },
    });
    assert.equal(got.length, 1, 'the entry is kept when check fails');
  });

  it('keeps entries when cleanliness returns wrong count — fail open', async () => {
    // A resolver that returns the wrong number of answers cannot be trusted.
    manifest('a.json', { session: 'x', pid: '4242', worktree: '/wt/x',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({ '/wt/x': 'finished' }),
      cleanliness: () => [], // wrong count
    });
    assert.equal(got.length, 1, 'the entry is kept when resolver misbehaves');
  });

  it('mixes kept and dropped in the same pass', async () => {
    // A realistic scenario: some workers still running, some ended but dirty,
    // some ended and clean (to be dropped).
    manifest('running.json', { session: 'running', pid: '1', worktree: '/wt/running',
      startedAt: '2026-08-20T12:00:00Z' });
    manifest('dirty.json', { session: 'dirty', pid: '2', worktree: '/wt/dirty',
      startedAt: '2026-08-20T11:00:00Z' });
    manifest('clean.json', { session: 'clean', pid: '3', worktree: '/wt/clean',
      startedAt: '2026-08-20T10:00:00Z' });
    const got = await readAgentRegistry(root, home, {
      liveness: fakeLiveness({
        '/wt/running': 'running',
        '/wt/dirty': 'finished',
        '/wt/clean': 'finished',
      }),
      cleanliness: fakeCleanliness({
        '/wt/running': true, // clean but running — kept
        '/wt/dirty': false, // dirty and ended — kept
        '/wt/clean': true, // clean and ended — dropped
      }),
    });
    assert.equal(got.length, 2);
    assert.deepEqual(got.map((e) => e.session), ['running', 'dirty']);
  });
});
