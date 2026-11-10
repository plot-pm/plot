import { execFileSync as realExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fleetdHeartbeatFile, gateContractFile } from '@plot-pm/domain/adapters';
import { FLEETD_HEARTBEAT_VERSION } from '@plot-pm/domain';
import type { RepoSnapshot } from '@plot-pm/domain/entities/snapshot';
import { freshWalkCache } from '@plot-pm/domain/workflows/plan-walk-cache';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Every process start made through `node:child_process`, one command line per start. */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const line = (command: unknown, args: unknown): string =>
    [String(command), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
  const wrap = <F extends (...a: never[]) => unknown>(name: string, fn: F): F => {
    const wrapped = ((...a: unknown[]) => {
      starts.lines.push(`${name} ${line(a[0], a[1])}`);
      return (fn as unknown as (...b: unknown[]) => unknown)(...a);
    }) as unknown as F;
    for (const key of Reflect.ownKeys(fn)) {
      if (key === 'length' || key === 'name') continue;
      Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)!);
    }
    return wrapped;
  };
  const counted = {
    ...real,
    spawn: wrap('spawn', real.spawn),
    spawnSync: wrap('spawnSync', real.spawnSync),
    exec: wrap('exec', real.exec),
    execSync: wrap('execSync', real.execSync),
    execFile: wrap('execFile', real.execFile),
    execFileSync: wrap('execFileSync', real.execFileSync),
    fork: wrap('fork', real.fork),
  };
  return { ...counted, default: counted };
});

import { boardAnswer } from '../../src/server/controllers/board-answer.js';
import { realEstate } from '../../src/server/estate.js';
import { boardInputsToServe, ensureCache, pauseFleetRefresh, planMetasAtDefault, stopFleetRefresh } from '../../src/server/fleet.js';
import type { BuildBoardOptions } from '../../src/server/board.js';
import { removeTree } from '../rm-tree.mjs';
import { buildSandbox, type Sandbox } from '../../../fleet/test/census/sandbox.js';
import { servedSnapshotOf } from './served-snapshot.js';

// BOTH PATHS RENDER THE SAME BOARD, plan `board-api-starts-nothing`, slice
// Serve. `/api/board` is rendered once by the board's own reads and once from
// the snapshot fleetd's walk records over the same repository, and the two
// payloads are compared field by field, without `server` and the read times.
//
// DESIGN DOCUMENTS: fleetd lists each story's `DESIGN-*.md` from the ref, and
// the board's own ref path lists none. The served path renders none, as the
// board renders today.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const made: string[] = [];
const boxes: Sandbox[] = [];
const savedEnv: Record<string, string | undefined> = {};
const setEnv = (name: string, value: string | undefined): void => {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

const tmp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterEach(async () => {
  stopFleetRefresh();
  starts.lines.length = 0;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete savedEnv[name];
  }
  for (const box of boxes.splice(0)) await box.remove();
  for (const dir of made.splice(0)) removeTree(dir);
});

const git = (cwd: string, ...args: string[]): string =>
  realExecFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

const write = (repo: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};

const plan = (title: string, status: string, rest = ''): string =>
  `# ${title}\n\n## Status\n\n${status}\n\n## Slices\n\n### One\n\n- \`feature/${title.toLowerCase().replace(/\s+/g, '-')}\`\n${rest}`;

/** The real scripts, with a `plot-host.sh` that answers nothing and reaches no host. */
const scriptsWithSilentHost = (): string => {
  const dir = tmp('plot-parity-scripts-');
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/** One card of each kind, on a repository with an `origin` it pushed to. */
const parityRepo = (): string => {
  const root = tmp('plot-parity-');
  setEnv('PLOT_PR_INDEX_HOME', root);
  setEnv('PLOT_BUDGET_HOME', root);
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  setEnv('PLOT_REPO_ROOT', repo);
  realExecFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', origin]);
  realExecFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  git(repo, 'remote', 'add', 'origin', origin);
  write(repo, 'CLAUDE.md', '# P\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n- **Branch prefixes:** idea/, feature/\n');
  write(repo, 'docs/plans/2026-10-01-delivered-one.md', plan(
    'Delivered one',
    '- **State:** Delivered\n- **Type:** feature\n- **Delivered:** 2026-10-03\n- **Verified:** 2026-10-04, refuted',
    '\n## Verification\n\n- Claim-1 supported — the first claim\n- Claim-2 refuted — the second claim\n',
  ));
  write(repo, 'docs/plans/2026-10-02-approved-one.md', plan(
    'Approved one',
    '- **State:** Approved\n- **Type:** feature\n- **Issue:** #7\n- **Rounds:** 2\n- **Story:** the-story\n- **Sprint:** the-sprint\n- **Approved:** 2026-10-02, jwloka',
  ));
  write(repo, 'docs/plans/2026-10-09-broken.md', 'not a plan at all\n');
  write(repo, 'docs/sprints/active/2026-W45-the-sprint.md', '# Sprint: The sprint\n\n## Status\n\n- **State:** Active\n\n### Must Have\n\n- [ ] [approved-one]\n- [x] a bare item\n');
  write(repo, 'docs/stories/the-story/STORY-the-story.md', '---\ntitle: The story\nstatus: active\nissue: "#7"\n---\n\n# The story\n');
  write(repo, 'docs/stories/the-story/DESIGN-the-story.md', '# Design\n');
  write(repo, 'docs/stories/archived/old/STORY-old.md', '---\ntitle: Old\nstatus: done\n---\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'checkout', '-q', '-b', 'feature/draft-on-feature');
  write(repo, 'docs/plans/2026-10-04-draft-on-feature.md', plan('Draft on feature', '- **State:** Draft\n- **Type:** feature'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'draft');
  git(repo, 'push', '-q', 'origin', 'feature/draft-on-feature');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-q', '-b', 'idea/short');
  write(repo, 'docs/plans/2026-10-05-a-longer-name.md', plan('A longer name', '- **State:** Draft\n- **Type:** feature\n- **Issue:** #9'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'idea');
  git(repo, 'push', '-q', 'origin', 'idea/short');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'fetch', '-q', 'origin');
  // A plan only this checkout holds.
  write(repo, 'docs/plans/2026-10-06-local-only.md', plan('Local only', '- **State:** Approved\n- **Type:** feature'));
  return repo;
};

/** The fields of `/api/board` that differ between two renders of the same estate whatever path read it. */
const VOLATILE = new Set(['server', 'generatedAt', 'planRefAgeSeconds']);

/** Every leaf where two payloads differ, each named by its path, a card by its slug. */
const differences = (own: unknown, served: unknown, at = ''): string[] => {
  if (Array.isArray(own) && Array.isArray(served)) {
    const named = (item: unknown, i: number): string =>
      typeof item === 'object' && item !== null && 'slug' in item ? `[${String((item as { slug: unknown }).slug)}]` : `[${i}]`;
    if (own.length !== served.length) {
      return [`${at}: own=${JSON.stringify(own.map(named))} snapshot=${JSON.stringify(served.map(named))}`];
    }
    return own.flatMap((item, i) => differences(item, served[i], `${at}${named(item, i)}`));
  }
  if (typeof own === 'object' && own !== null && typeof served === 'object' && served !== null) {
    const keys = new Set([...Object.keys(own), ...Object.keys(served)]);
    return [...keys]
      .filter((key) => at !== '' || !VOLATILE.has(key))
      .flatMap((key) => differences((own as Record<string, unknown>)[key], (served as Record<string, unknown>)[key], `${at}.${key}`));
  }
  return JSON.stringify(own) === JSON.stringify(served) ? [] : [`${at}: own=${JSON.stringify(own)} snapshot=${JSON.stringify(served)}`];
};

/** A live heartbeat, so the board's source is `snapshot` while a stream is attached. */
const liveHeartbeat = async (repoRoot: string): Promise<void> => {
  const now = Date.now();
  await fleetdHeartbeatFile({ repoRoot }).write({
    version: FLEETD_HEARTBEAT_VERSION,
    pid: process.pid,
    startedAt: now - 600_000,
    beatAt: now,
    generation: 1,
    bridgeAt: null,
    supervised: 'launchd',
    watchesWanted: 0,
    watchesArmed: 0,
    lastEventAt: null,
    lastSafetyNetAt: null,
    loops: {},
  });
};

/** The board's options over a repository, with a gate that answers and a bundle that exists. */
const optsFor = (repoRoot: string, scriptsDir: string): BuildBoardOptions => {
  const gateDir = tmp('plot-parity-gate-');
  const gatePath = path.join(gateDir, 'plot-gate.mjs');
  fs.writeFileSync(gatePath, 'console.log(1);\n');
  return {
    repoRoot,
    scriptsDir,
    gateContract: gateContractFile({ pluginRoot: tmp('plot-parity-plugins-'), repoGatePath: gatePath }),
    startBundle: { path: gatePath, hash: null },
  } as BuildBoardOptions;
};

/** Both renders of `/api/board`: the board's own reads first, then fleetd's snapshot. */
const bothPaths = async (
  opts: BuildBoardOptions,
  snapshot: RepoSnapshot,
  prepare: (served: BuildBoardOptions) => void = () => undefined,
): Promise<{ own: Record<string, unknown>; served: Record<string, unknown> }> => {
  const own = await boardAnswer(opts, realEstate(opts), 'localhost', 7777, false);
  pauseFleetRefresh();
  await liveHeartbeat(opts.repoRoot);
  const served: BuildBoardOptions = {
    ...opts,
    channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: 1 }, held: { epoch: 'e1', snapshot } }),
  };
  ensureCache(served).clients = 1;
  prepare(served);
  const answer = await boardAnswer(served, realEstate(served), 'localhost', 7777, false);
  pauseFleetRefresh();
  return { own: own as unknown as Record<string, unknown>, served: answer as unknown as Record<string, unknown> };
};

/** Waits until no process has started for two seconds, so a background beat cannot land in a measured request. */
const quiet = async (): Promise<void> => {
  for (let still = 0, seen = -1; still < 10; ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    still = starts.lines.length === seen ? still + 1 : 0;
    seen = starts.lines.length;
  }
};

const cardsOf = (payload: Record<string, unknown>): string[] =>
  (payload.columns as { cards: { slug: string }[] }[]).flatMap((c) => c.cards.map((card) => card.slug)).sort();

describe('/api/board renders the same board from the snapshot as from its own reads', () => {
  it('over the parity fixture: one card of each kind', async () => {
    const repoRoot = parityRepo();
    const scriptsDir = scriptsWithSilentHost();
    const opts = optsFor(repoRoot, scriptsDir);
    const snapshot = await servedSnapshotOf(repoRoot, scriptsDir);
    const { own, served } = await bothPaths(opts, snapshot);
    expect(await boardInputsToServe({ ...opts, channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: 1 }, held: { epoch: 'e1', snapshot } }) })).not.toBeNull();
    expect(cardsOf(own)).toEqual(['a-longer-name', 'approved-one', 'delivered-one', 'draft-on-feature', 'local-only']);
    expect(differences(own, served)).toEqual([]);
    expect(own).not.toHaveProperty('servedFrom');
    expect(served).not.toHaveProperty('servedFrom');
    const cards = (served.columns as { cards: Record<string, unknown>[] }[]).flatMap((c) => c.cards);
    expect(cards.find((c) => c.slug === 'delivered-one')?.verification).toBeDefined();
    expect(cards.find((c) => c.slug === 'approved-one')).toMatchObject({ issues: ['7'], rounds: 2 });
    expect(cards.find((c) => c.slug === 'local-only')?.notPushed).toBe(true);
    expect((served.stories as { slug: string; designDocs: string[] }[]).map((s) => [s.slug, s.designDocs])).toEqual([['the-story', []]]);
    expect((served.archivedStories as { slug: string }[]).map((s) => s.slug)).toEqual(['old']);
  }, 120_000);

  it('with issues served from the index: the ticket lane reads the snapshot and starts nothing', async () => {
    const repoRoot = parityRepo();
    const scriptsDir = scriptsWithSilentHost();
    const opts = optsFor(repoRoot, scriptsDir);
    const snapshot = await servedSnapshotOf(repoRoot, scriptsDir);
    const issueRow = (number: string, title: string) => ({ number, title, state: 'open', assignees: [], labels: [], url: '', updatedAt: '2026-11-01T00:00:00Z' });
    const lanes = (target: BuildBoardOptions): void => {
      const entry = ensureCache(target);
      entry.issueSets = { rows: [issueRow('7', 'Seven'), issueRow('9', 'Nine')], closed: null } as unknown as typeof entry.issueSets;
      entry.prs = new Map([['idea/short', { number: 11, head: 'idea/short' }]]) as unknown as typeof entry.prs;
      entry.ideaPlans = new Map([['idea/short', '2026-10-05-a-longer-name.md']]);
    };
    lanes(opts);
    const own = await boardAnswer(opts, realEstate(opts), 'localhost', 7777, false);
    pauseFleetRefresh();
    const { served } = await bothPaths(opts, snapshot, lanes);
    await quiet();
    const servedOpts = { ...opts, channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: 1 }, held: { epoch: 'e1', snapshot } }) };
    // One request after the wait reads the checkout's branch, whose 5 s TTL
    // the wait outlasts (`refs-from-files` moves that read to a file); the
    // next request is the one measured.
    await boardAnswer(servedOpts, realEstate(servedOpts), 'localhost', 7777, false);
    starts.lines.length = 0;
    await boardAnswer(servedOpts, realEstate(servedOpts), 'localhost', 7777, false);
    pauseFleetRefresh();
    expect(starts.lines).toEqual([]);
    expect(differences({ tickets: own.tickets }, { tickets: served.tickets })).toEqual([]);
    expect(JSON.stringify(served.tickets)).toContain('a-longer-name');
  }, 120_000);

  it.each([
    ['authors failed', (s: RepoSnapshot) => {
      if (s.readings.plans.state === 'read') s.readings.plans.value.authors = { state: 'failed', reason: 'the plan authors could not be read' };
    }],
    ['plans read from the checkout', (s: RepoSnapshot) => {
      if (s.readings.plans.state === 'read') s.readings.plans.value = { ...s.readings.plans.value, ref: 'worktree', resolved: '' };
    }],
    ['branchPlans unread', (s: RepoSnapshot) => {
      s.readings.branchPlans = { state: 'unread' };
    }],
  ] as const)('with %s, runs the board\'s own path and renders what it renders', async (_name, spoil) => {
    const repoRoot = parityRepo();
    const scriptsDir = scriptsWithSilentHost();
    const opts = optsFor(repoRoot, scriptsDir);
    const snapshot = await servedSnapshotOf(repoRoot, scriptsDir);
    spoil(snapshot);
    const { own, served } = await bothPaths(opts, snapshot);
    // The served request built by the board's own reads: there are no inputs to serve.
    expect(await boardInputsToServe({ ...opts, channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: 1 }, held: { epoch: 'e1', snapshot } }) })).toBeNull();
    expect(differences(own, served)).toEqual([]);
    const authors = (served.columns as { cards: { slug: string; author?: string }[] }[]).flatMap((c) => c.cards).filter((c) => c.slug !== 'local-only' && c.slug !== 'a-longer-name' && c.slug !== 'draft-on-feature');
    expect(authors.every((c) => c.author === 't')).toBe(true);
  }, 120_000);
});

describe.each([
  { host: 'github' as const, desks: 0, openPrs: 0 },
  { host: 'github' as const, desks: 3, openPrs: 3 },
  { host: 'bitbucket' as const, desks: 0, openPrs: 0 },
  { host: 'bitbucket' as const, desks: 3, openPrs: 3 },
])('/api/board over the census fixture host=$host desks=$desks', (fixture) => {
  it('renders the same board from the snapshot as from its own reads', async () => {
    const box = await buildSandbox(fixture);
    boxes.push(box);
    for (const [key, value] of Object.entries(box.env)) if (process.env[key] !== value) setEnv(key, value);
    const opts = optsFor(box.repo, box.scriptsDir);
    const snapshot = await servedSnapshotOf(box.repo, box.scriptsDir);
    const { own, served } = await bothPaths(opts, snapshot);
    expect(cardsOf(own).length).toBeGreaterThan(0);
    expect(differences(own, served)).toEqual([]);
  }, 120_000);

  it('a request on snapshot leaves the PR beat\'s plan reads cached', async () => {
    const box = await buildSandbox(fixture);
    boxes.push(box);
    for (const [key, value] of Object.entries(box.env)) if (process.env[key] !== value) setEnv(key, value);
    const opts = optsFor(box.repo, box.scriptsDir);
    const snapshot = await servedSnapshotOf(box.repo, box.scriptsDir);
    const entries = snapshot.readings.refs.state === 'read' ? snapshot.readings.refs.value.entries : [];
    // THE PR BEAT on `snapshot` reads the plans at the snapshot's refs (`readIssuesFromStore`).
    expect(await planMetasAtDefault(opts, ensureCache(opts), entries)).not.toBeNull();
    await bothPaths(opts, snapshot);
    await quiet();
    starts.lines.length = 0;
    await planMetasAtDefault(opts, ensureCache(opts), entries);
    expect(starts.lines).toEqual([]);
  }, 120_000);
});

describe('no read is made twice', () => {
  /**
   * The starts that read what the cards read: the plan parser, `planAuthors`'s
   * `git log` and `recordCommit`'s `git log`. The walk's other `git log` reads
   * (merge subjects, plan additions, branch ranges) belong to the pulse and
   * run on both sides; a walk that records nothing skips some of them, so they
   * are not compared.
   */
  const planReads = (lines: readonly string[]) => ({
    parser: lines.filter((l) => l.includes('plot-plan-meta.sh')).length,
    authors: lines.filter((l) => /\bgit\b.*\slog\s.*--format=@%H\t%an/.test(l)).length,
    deliveryCommits: lines.filter((l) => /\bgit\b.*\slog\s.*Delivered:/.test(l)).length,
  });

  /** Moves the default branch: one plan edited, committed and pushed, then fetched. */
  const moveMain = (repo: string): void => {
    fs.appendFileSync(path.join(repo, 'docs/plans/2026-10-02-approved-one.md'), '\nOne more line.\n');
    git(repo, 'commit', '-q', '-am', 'move');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'fetch', '-q', 'origin');
  };

  it('a fleetd pass after a move plus one request on snapshot reads no more than the walk without readings plus the board\'s own build', async () => {
    const scriptsDir = scriptsWithSilentHost();
    // NOW: fleetd records the card readings, and the board serves from them.
    const now = parityRepo();
    const nowOpts = optsFor(now, scriptsDir);
    const nowCache = freshWalkCache();
    const servedOf = (snapshot: RepoSnapshot): BuildBoardOptions => ({
      ...nowOpts,
      channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: snapshot.generation }, held: { epoch: 'e1', snapshot } }),
    });
    await liveHeartbeat(now);
    let snapshot = await servedSnapshotOf(now, scriptsDir, { cache: nowCache });
    ensureCache(servedOf(snapshot)).clients = 1;
    await boardAnswer(servedOf(snapshot), realEstate(servedOf(snapshot)), 'localhost', 7777, false);
    pauseFleetRefresh();
    // BEFORE: fleetd's walk records nothing, and the board reads for itself.
    const before = parityRepo();
    const beforeOpts = optsFor(before, scriptsDir);
    const beforeCache = freshWalkCache();
    await servedSnapshotOf(before, scriptsDir, { cache: beforeCache, record: false });
    await boardAnswer(beforeOpts, realEstate(beforeOpts), 'localhost', 7777, false);
    pauseFleetRefresh();
    await quiet();

    moveMain(now);
    moveMain(before);
    starts.lines.length = 0;
    snapshot = await servedSnapshotOf(now, scriptsDir, { cache: nowCache, generation: 2 });
    await liveHeartbeat(now);
    await boardAnswer(servedOf(snapshot), realEstate(servedOf(snapshot)), 'localhost', 7777, false);
    pauseFleetRefresh();
    const nowReads = planReads(starts.lines);
    starts.lines.length = 0;
    await servedSnapshotOf(before, scriptsDir, { cache: beforeCache, record: false });
    await boardAnswer(beforeOpts, realEstate(beforeOpts), 'localhost', 7777, false);
    pauseFleetRefresh();
    const beforeReads = planReads(starts.lines);
    console.log(`per default-branch move: now ${JSON.stringify(nowReads)}, before ${JSON.stringify(beforeReads)}`);
    expect(nowReads.parser).toBeLessThanOrEqual(beforeReads.parser);
    expect(nowReads.authors).toBeLessThanOrEqual(beforeReads.authors);
    expect(nowReads.deliveryCommits).toBeLessThanOrEqual(beforeReads.deliveryCommits);
  }, 120_000);
});
