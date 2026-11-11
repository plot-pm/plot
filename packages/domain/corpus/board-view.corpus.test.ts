import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSandbox, type Sandbox } from '../../fleet/test/census/sandbox.js';
import { freshScanState, scanOnce, type ScanResult, type ScanWorld } from '../../fleet/src/shared/fleet-scan.js';
import { mapsOfRows as boardMapsOfRows } from '../../fleet/src/shared/pr-refresh.js';
import { createSnapshotHolder, readOf } from '../../fleet/src/shared/snapshot-fill.js';
import { workerQuestions } from '../../fleet/src/shared/worker-question.js';
import {
  agentsFs,
  hostShell,
  planParserPath,
  planStoreRef,
  planStoreShell,
  processesFiles,
  refsGit,
  scriptsShell,
  treesGit,
} from '../src/adapters/index.js';
import type { PrIndexRow } from '../src/entities/pr-index.js';
import { READING_KEYS, RepoSnapshotSchema, type ReadingKey } from '../src/entities/snapshot.js';
import { claimOnly } from '../src/rules/empty-claim.js';
import { HOST_BRANCH_URL_SCHEMES } from '../src/adapters/host/host-branch-urls.js';
import { fleetViewFrom, type BoardView } from '../src/workflows/board-view.js';
import { compareField, describingAs, type Disagreement } from './compare.js';

/**
 * THE BOARD'S VIEW FROM A SNAPSHOT AGAINST THE BOARD'S OWN READS: does
 * `fleetViewFrom`, over the snapshot fleetd fills, give every cache field the
 * board's `refresh` installs today?
 *
 * Today's side is what `refresh` runs when it scans for itself: `scanOnce`
 * (pulse, ages, tip times, branch links, approval dates, idea plans), and the
 * board's own git reads for release versions, unmerged and claim-only
 * branches, re-run here as `fleet.ts` runs them, and `workerQuestions`. The
 * snapshot side is the same `scanOnce` with fleetd's `record` hook, carried
 * through a JSON round trip and `RepoSnapshotSchema`, as the channel carries
 * it. Fixtures are the census sandboxes, with a release branch, a claim-only
 * branch, an unmerged branch, an idea branch and a desk question added.
 */

const sides = describingAs({ left: 'snapshot', right: 'board' });

/** A map or set as sorted entries, so `compareField` compares it by value. */
const plain = (value: unknown): unknown => {
  if (value instanceof Map) return [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
  if (value instanceof Set) return [...value].sort();
  return value;
};

const run = (box: Sandbox, args: string[]): string =>
  execFileSync('git', args, { cwd: box.repo, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** `releaseVersions` in `packages/board/src/server/fleet.ts`, as it reads. */
const boardReleaseVersions = (box: Sandbox): Map<string, string> => {
  const found = new Map<string, string>();
  const branches = run(box, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/changeset-release/*'])
    .split('\n')
    .map((l) => l.trim().replace(/^origin\//, ''))
    .filter(Boolean);
  for (const branch of branches) {
    let raw = '';
    try {
      raw = run(box, ['show', `origin/${branch}:package.json`]);
    } catch {
      continue;
    }
    try {
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === 'string' && version) found.set(branch, version);
    } catch {
      continue;
    }
  }
  return found;
};

/** `unmergedBranches` in `packages/board/src/server/fleet.ts`, as it reads. */
const boardUnmerged = (box: Sandbox, main: string): Set<string> => {
  const found = new Set<string>();
  for (const line of run(box, ['branch', '-r', '--no-merged', `origin/${main}`, '--format=%(refname:short)']).split('\n')) {
    const ref = line.trim();
    if (!ref.startsWith('origin/') || ref === 'origin/HEAD') continue;
    const short = ref.slice('origin/'.length);
    if (short && short !== main) found.add(short);
  }
  return found;
};

/** `claimOnlyBranches` in `packages/board/src/server/fleet.ts`, as it reads. */
const boardClaimOnly = async (box: Sandbox, main: string, unmerged: ReadonlySet<string>): Promise<Set<string>> => {
  const found = new Set<string>();
  const refs = refsGit({ repoRoot: box.repo, scriptDir: box.scriptsDir });
  for (const line of run(box, ['for-each-ref', '--format=%(refname:short)%09%(subject)', 'refs/remotes/origin']).split('\n')) {
    const at = line.indexOf('\t');
    if (at < 0) continue;
    const ref = line.slice(0, at);
    if (!ref.startsWith('origin/') || !line.slice(at + 1).startsWith('plot: claim ')) continue;
    const branch = ref.slice('origin/'.length);
    if (!unmerged.has(branch)) continue;
    const range = await refs.commitSubjects(`origin/${main}..origin/${branch}`);
    if (range.ok && claimOnly(range.value)) found.add(branch);
  }
  return found;
};

/** Adds the branches and the marker the census fixture lacks. */
const widen = (box: Sandbox): void => {
  const git = (...args: string[]) => run(box, args);
  git('switch', '--quiet', '-c', 'changeset-release/main', 'main');
  writeFileSync(join(box.repo, 'package.json'), '{"name":"census","version":"9.1.0"}\n');
  git('add', 'package.json');
  git('commit', '--quiet', '-m', 'release: 9.1.0');
  git('switch', '--quiet', '-c', 'feature/census-claim-only', 'main');
  git('commit', '--quiet', '--allow-empty', '-m', 'plot: claim feature/census-claim-only');
  git('switch', '--quiet', '-c', 'feature/census-loose', 'main');
  writeFileSync(join(box.repo, 'loose.txt'), 'work\n');
  git('add', 'loose.txt');
  git('commit', '--quiet', '-m', 'loose work');
  git('switch', '--quiet', '-c', 'idea/census-idea', 'main');
  mkdirSync(join(box.repo, 'docs/plans'), { recursive: true });
  writeFileSync(join(box.repo, 'docs/plans/2026-11-09-census-idea.md'), '# Census idea\n\n## Status\n\n- **State:** Draft\n');
  git('add', 'docs/plans/2026-11-09-census-idea.md');
  git('commit', '--quiet', '-m', 'plot: idea census-idea');
  git('switch', '--quiet', 'main');
  for (const branch of ['changeset-release/main', 'feature/census-claim-only', 'feature/census-loose', 'idea/census-idea']) {
    git('push', '--quiet', 'origin', branch);
  }
  git('fetch', '--quiet', 'origin');
  const desk = box.desks[0];
  if (desk !== undefined) writeFileSync(join(desk.worktree, 'PLOT-BLOCKED.md'), 'Which way does the census go?\n');
};

const worldOf = (box: Sandbox, record?: ScanWorld['record']): ScanWorld => {
  const context = { repoRoot: box.repo, scriptDir: box.scriptsDir };
  return {
    repoRoot: box.repo,
    scripts: scriptsShell(context),
    refs: refsGit(context),
    backend: async () => {
      const answer = await hostShell(context).backend();
      return answer.ok ? answer.value : 'github';
    },
    walk: {
      host: hostShell(context),
      plans: (ref, planDir) => planStoreRef(refsGit(context), context, ref, planDir),
      worktree: planStoreShell(context),
      trees: treesGit(context),
      agents: agentsFs(context),
      processes: processesFiles(context),
      parser: planParserPath(context),
    },
    ...(record === undefined ? {} : { record }),
  };
};

/** One PR index row per open census PR, as fleetd's PR reader records them. */
const prRowsOf = (box: Sandbox, result: ScanResult): PrIndexRow[] =>
  result.reading.plans
    .flatMap((plan) => plan.slices.flatMap((slice) => slice.branches))
    .slice(0, box.size.openPrs)
    .map((b, i) => ({ number: i + 1, head: b.branch, state: 'OPEN', draft: false, checks: 'pending', review: '', url: `u${i + 1}` }));

/** Today's view: the board's `refresh` installs these from its own reads. */
interface BoardSide {
  result: ScanResult;
  versions: Map<string, string>;
  unmerged: Set<string>;
  claimOnly: Set<string>;
  questions: Map<string, unknown>;
}

const disagreements = (subject: string, view: BoardView, board: BoardSide, rows: readonly PrIndexRow[]): Disagreement[] => {
  const found: Disagreement[] = [];
  const field = (name: string, left: unknown, right: unknown) => compareField(found, subject, name, plain(left), plain(right));
  const { result } = board;
  const pulse = view.pulse === 'unknown' ? 'unknown' : { ...view.pulse };
  // The scan stamps `changed_at` from its own clock; both sides read one walk here.
  field('pulse', pulse, result.reading);
  field('lastComplete', view.pulse, result.reading);
  field('tipAt', view.tipAt, result.tipAt);
  // Ages are minutes against two clocks a few hundred ms apart; a minute boundary between them moves one by 1.
  const ages = view.ages === 'unknown' ? 'unknown' : [...view.ages.entries()].map(([b, age]) => {
    const theirs = result.ages.get(b);
    return [b, age !== null && theirs != null && Math.abs(age - theirs) <= 1 ? theirs : age];
  });
  field('ages', ages, [...result.ages.entries()]);
  field('branchUrlBase', view.branchUrlBase, result.branchUrlBase);
  field('approvedAt', view.approvedAt, result.approvedAt);
  field('ideaPlans', view.ideaPlans, result.ideaPlans);
  field('versions', view.versions, board.versions);
  field('unmerged', view.unmerged, board.unmerged);
  field('claimOnly', view.claimOnly, board.claimOnly);
  field('questions', view.questions, board.questions);
  const maps = boardMapsOfRows(rows);
  field('prs', view.prs, maps.prs);
  field('prsByNumber', view.prsByNumber, maps.byNumber);
  field('prsByHead', view.prsByHead, maps.byHead);
  return found;
};

const FIXTURES = [
  { host: 'github', desks: 0, openPrs: 5 },
  { host: 'github', desks: 3, openPrs: 5 },
  { host: 'bitbucket', desks: 0, openPrs: 5 },
  { host: 'bitbucket', desks: 3, openPrs: 5 },
] as const;

describe.each(FIXTURES)('fleetViewFrom against the board on the census fixture host=$host desks=$desks', (size) => {
  let box: Sandbox;
  const saved = { ...process.env };

  beforeAll(async () => {
    box = await buildSandbox(size);
    Object.assign(process.env, box.env);
    widen(box);
  }, 120_000);

  afterAll(async () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await box?.remove();
  }, 60_000);

  it('agrees with the board on every cache field the views read', async () => {
    const holder = createSnapshotHolder();
    const result = await scanOnce(worldOf(box, holder.record), freshScanState(), { record: false });
    const rows = prRowsOf(box, result);
    holder.record('prs', readOf(rows));
    const unmerged = boardUnmerged(box, result.reading.main);
    const board: BoardSide = {
      result,
      versions: boardReleaseVersions(box),
      unmerged,
      claimOnly: await boardClaimOnly(box, result.reading.main, unmerged),
      questions: await workerQuestions(result.reading, box.repo),
    };
    const carried = RepoSnapshotSchema.parse(JSON.parse(JSON.stringify(holder.current())));
    const view = fleetViewFrom(carried, Date.now(), HOST_BRANCH_URL_SCHEMES);

    // The fixture reaches every field: a field empty on both sides proves nothing.
    expect(board.versions.size, 'the release branch').toBe(1);
    expect(board.claimOnly.size, 'the claim-only branch').toBe(1);
    expect(board.unmerged.has('feature/census-loose'), 'the unmerged branch').toBe(true);
    expect(result.ideaPlans.size, 'the idea branch').toBe(1);
    expect(result.approvedAt.size, 'the approved plan').toBe(1);
    expect(board.questions.size, 'the desk question').toBe(size.desks > 0 ? 1 : 0);

    const found = disagreements(`census ${size.host} desks=${size.desks}`, view, board, rows);
    expect(found.map(sides), 'the snapshot view and the board disagree').toEqual([]);
  });
});

/**
 * Where each cache field `refresh` writes comes from on the snapshot path: the
 * snapshot keys it is derived from, state the board keeps for itself, or a
 * value no reading yet carries.
 */
type Source = { keys: readonly ReadingKey[] } | { board: string } | { gap: string };

const PULSE: readonly ReadingKey[] = ['walk', 'plans', 'deskFiles', 'workers'];
const SCANNER = { board: 'the scanner carries it between its own beats; on the snapshot path fleetd scans and the board does not' };

const FIELD_SOURCES: Readonly<Record<string, Source>> = {
  pulse: { keys: PULSE },
  lastComplete: { keys: PULSE },
  pulseComplete: { keys: ['walk'] },
  at: { keys: ['walk'] },
  fetchedAt: { keys: ['walk'] },
  ages: { keys: ['branchDates'] },
  tipAt: { keys: ['branchDates'] },
  branchUrlBase: { keys: ['walk'] },
  approvedAt: { keys: ['plans', 'walk'] },
  ideaPlans: { keys: ['ideaPlans'] },
  versions: { keys: ['releaseVersions'] },
  unmerged: { keys: ['unmerged'] },
  claimOnly: { keys: ['unmerged'] },
  questions: { keys: ['questions'] },
  running: { board: 'whether the board runs a refresh now' },
  heartbeat: { board: "fleetd's heartbeat file, read on every beat to pick the source" },
  viewSource: { board: 'whether the last refresh served the snapshot or read for itself' },
  appliedBridgeAt: { board: 'the bridge stamp the board last applied' },
  scanNote: { board: "a note on the age of fleetd's bridge" },
  shrink: { board: "the board's comparison of this pulse with its previous one" },
  error: { board: "the board's own scan failure; with the estate measure only on a timeout" },
  terminal: SCANNER,
  listing: SCANNER,
  listingAt: SCANNER,
  listingIntervalMs: SCANNER,
  listingBranches: SCANNER,
  listingReusedAgeMs: SCANNER,
  listingHeld: SCANNER,
  backoffUntil: SCANNER,
  backoffMs: SCANNER,
  calls: SCANNER,
  walkCache: SCANNER,
  agents: {
    gap: 'readAgentRegistryWithInfo synthesizes an entry per unregistered desk and asks liveness, cleanliness and transcript usage per entry; the registry reading holds the manifests alone',
  },
  registry: { gap: 'the directory and the synthesized count come from readAgentRegistryWithInfo, which fleetd does not run' },
  supervisor: { gap: "a machine answer about fleetd, not a repository reading; fleetd's heartbeat replaces it" },
};

const repoRoot = resolve(import.meta.dirname, '../../..');

/** Every `entry.<field> =` in `refresh`, and every field of the `ScanState` `scanOnce` writes into the entry. */
const writtenByRefresh = (): string[] => {
  const fleet = readFileSync(join(repoRoot, 'packages/board/src/server/fleet.ts'), 'utf8');
  const start = fleet.indexOf('export async function refresh(');
  const end = fleet.indexOf('export function freshCacheEntry', start);
  const body = fleet.slice(start, end);
  const scan = readFileSync(join(repoRoot, 'packages/fleet/src/shared/fleet-scan.ts'), 'utf8');
  const state = scan.slice(scan.indexOf('export interface ScanState'), scan.indexOf('\n}\n', scan.indexOf('export interface ScanState')));
  return [
    ...new Set([
      ...[...body.matchAll(/entry\.([A-Za-z]+) = /g)].map((m) => m[1]!),
      ...[...state.matchAll(/^ {2}([A-Za-z]+)\??:/gm)].map((m) => m[1]!),
    ]),
  ].sort();
};

describe('every cache field refresh writes has a source', () => {
  it('names a snapshot key, board state or a declared gap for each field', () => {
    const written = writtenByRefresh();
    expect(written.length).toBeGreaterThan(20);
    expect(written.filter((field) => FIELD_SOURCES[field] === undefined), 'fields refresh writes with no source').toEqual([]);
  });

  it('names only real reading keys', () => {
    for (const source of Object.values(FIELD_SOURCES)) {
      if ('keys' in source) for (const key of source.keys) expect(READING_KEYS).toContain(key);
    }
  });

  it('declares exactly these gaps', () => {
    const gaps = Object.entries(FIELD_SOURCES).filter(([, source]) => 'gap' in source).map(([field]) => field);
    expect(gaps).toEqual(['agents', 'registry', 'supervisor']);
  });
});
