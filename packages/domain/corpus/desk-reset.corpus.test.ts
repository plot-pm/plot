import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  finishedWith,
  firstResetRefusal,
  type FinishedWithReadings,
} from '../src/rules/reapable.js';
// `AheadReading` is declared by `movable.ts`; `reapable.ts` imports it without
// re-exporting, so it is taken from its home rather than through a module that
// merely uses it.
import type { AheadReading } from '../src/rules/movable.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';
import { readDesk, type DeskResetRow, type Estate } from './production.js';

/**
 * THE SECOND RULE-VERSUS-SHELL COMPARISON: does `resetRefusals` answer what
 * `plot-worker-loop.sh:desk_reset_refusal` answers, over a desk in every state
 * a desk can be in?
 *
 * THE PAIR EXISTS ON PURPOSE. `docs/shell-and-domain.md` settles which side of
 * the cost rule the loop falls on: it runs once per agent per pass, where a
 * 39 ms bundle hop is paid by every agent forever, so it duplicates the rule
 * and this holds the pair. NEITHER SIDE IS AUTHORITATIVE — on a disagreement
 * the branch stops, and adjusting either side to make this pass is the one move
 * forbidden.
 *
 * THE CORPUS IS CONSTRUCTED, AND THAT IS THIS PAIR'S DIFFERENCE FROM THE FIRST.
 * `sprint-score.corpus.test.ts` reads 134 sprint items that are checked into
 * the repository, so every runner sees the same corpus. A DESK is not in the
 * repository — it is a worktree on a machine, and what holds it is whatever an
 * agent happened to leave there. Measured 2026-09-08 on this estate: 17 desks
 * answering `resettable`, `uncommitted-changes` and `blocked-marker` and never
 * `unpushed-commits`, with the split moving as agents edited files during the
 * measurement. **CI's checkout has ONE worktree and it is clean**, so a live
 * corpus would be a comparison that can only pass — the failure
 * `docs/shell-and-domain.md` names by that name.
 *
 * So each state is BUILT, in a real repository with a real origin, and read
 * back through the loop's own `plot_worker_blocked` and `plot_worker_dirty`.
 * The shell under test is the shipped shell; only the estate it reads is made
 * here, and it is made because the answer must not depend on who was typing.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The pair this file compares, and the words its report uses.
 *
 * Two implementations of one rule, so neither is `adapter=` and neither is
 * `production=` — the reader has to be sent to the right file.
 */
const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** One desk, what the shell read of it, and what it is meant to exercise. */
interface Case {
  /** What state this desk was built to be in — the subject of a report. */
  name: string;
  /** The shell's readings and verdict. */
  row: DeskResetRow;
}

let sandbox = '';
let cases: Case[] = [];

/**
 * A repository with an origin and one desk per state.
 *
 * THE ORIGIN IS REAL because the third condition counts against `@{upstream}`,
 * and a fixture with no remote could not tell a pushed branch from an unpushed
 * one — it would answer `unknown` for every desk and exercise nothing.
 */
const buildDesks = (): Case[] => {
  const origin = join(sandbox, 'origin.git');
  const work = join(sandbox, 'work');
  git(sandbox, 'init', '--bare', '-q', '-b', 'main', origin);
  git(sandbox, 'clone', '-q', origin, work);
  git(work, 'config', 'user.email', 'corpus@example.invalid');
  git(work, 'config', 'user.name', 'Plot Corpus');
  git(work, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(work, 'README.md'), '# corpus\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'main');

  /** A desk on its own branch, pushed, so `ahead` is 0 unless a case moves it. */
  const desk = (label: string): string => {
    const path = join(sandbox, `desk-${label}`);
    git(work, 'worktree', 'add', '-q', '-b', `feature/${label}`, path, 'origin/main');
    git(path, 'commit', '-q', '--allow-empty', '-m', `plot: claim feature/${label}`);
    git(path, 'push', '-qu', 'origin', `feature/${label}`);
    return path;
  };

  const built: Array<{ name: string; path: string }> = [];

  // Nothing holds it — the normal case, and the one a wrong rule strands.
  built.push({ name: 'resettable', path: desk('clean') });

  // A person owes this desk an answer.
  const blocked = desk('blocked');
  writeFileSync(join(blocked, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which side is right?\n');
  built.push({ name: 'blocked-marker', path: blocked });

  // Work on the floor.
  const dirty = desk('dirty');
  writeFileSync(join(dirty, 'README.md'), '# corpus, edited\n');
  built.push({ name: 'uncommitted-changes', path: dirty });

  // Work that exists only here — the condition `finishedWith` could not say
  // before this slice, and the one the live estate never produced.
  const ahead = desk('ahead');
  writeFileSync(join(ahead, 'README.md'), '# corpus, committed\n');
  git(ahead, 'add', '-A');
  git(ahead, 'commit', '-qm', 'work nobody else has');
  built.push({ name: 'unpushed-commits', path: ahead });

  // A branch with NO upstream at all, so the count cannot be taken and both
  // sides must decline to refuse on it.
  //
  // `--no-track` IS REQUIRED, and finding that out is worth recording: a plain
  // `git worktree add -b … origin/main` sets `origin/main` as the new branch's
  // upstream, so a desk whose claim push never happened still counts — against
  // MAIN. That is the common case and it answers a number; the unaskable one
  // needs a branch git was told not to track.
  const noUpstream = join(sandbox, 'desk-no-upstream');
  git(work, 'worktree', 'add', '-q', '--no-track', '-b', 'feature/no-upstream',
      noUpstream, 'origin/main');
  built.push({ name: 'no-upstream', path: noUpstream });

  // Plot's own records are not work an agent left. `plot_worker_dirty` drops
  // them, and a domain reading assembled from a naive `git status` would not —
  // which is exactly why production supplies the readings.
  const records = desk('records');
  writeFileSync(join(records, '.plot-worker.log'), 'a line the fleet wrote\n');
  built.push({ name: 'plot-records-only', path: records });

  // The marker WINS over a dirty tree, so the ordering is compared and not just
  // the verdict. An agent that stopped to ask a question usually left an edit.
  const both = desk('both');
  writeFileSync(join(both, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: and the tree is dirty\n');
  writeFileSync(join(both, 'README.md'), '# corpus, edited too\n');
  built.push({ name: 'marker-over-dirty', path: both });

  return built.map(({ name, path }) => ({ name, row: readDesk(estate, path) }));
};

/**
 * The domain reading built from what the shell was given.
 *
 * THE FOUR CONDITIONS THE LOOP DOES NOT MEASURE ARE PASSED AS THEY WOULD BE
 * ANSWERED OF A DESK AN AGENT IS SITTING IN, and none of them reaches
 * `resetRefusals` — that is asserted in `test/reapable.test.ts` rather than
 * assumed here. Setting them to anything else would still compare equal, which
 * is why the assertion belongs in a unit test and this one only has to be
 * honest.
 */
const asReadings = (row: DeskResetRow): FinishedWithReadings => ({
  branch: 'feature/one',
  defaultBranch: 'main',
  isMain: false,
  // The agent asking IS the live worker; the loop never reads the condition.
  workerPid: null,
  dirtyPath: row.dirtyPath,
  blockedMarker: row.blockedMarker,
  merge: 'not-merged',
  givenUp: false,
  openPr: false,
  checkedOut: true,
  tree: 'present',
  ahead: row.ahead as AheadReading,
});

/** The rule's verdict in the shell's own vocabulary — `''` means resettable. */
const ruleVerdict = (row: DeskResetRow): string =>
  firstResetRefusal(finishedWith(asReadings(row))) ?? '';

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'plot-desk-corpus-'));
  cases = buildDesks();
});

afterAll(() => {
  if (sandbox !== '') rmSync(sandbox, { recursive: true, force: true });
});

describe('resetRefusals agrees with plot-worker-loop.sh desk_reset_refusal', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR, because the comparison below is universally quantified and a
    // universal claim over an empty set is true.
    expect(cases.length).toBeGreaterThan(5);
    expect(cases.every((one) => one.row.path !== '')).toBe(true);
  });

  it('exercises every answer the rule can give, so this is not vacuous', () => {
    // Both sides answer four things — three refusals and no refusal at all. If
    // the corpus only ever produced one, agreement would be an accident of the
    // estate rather than a property of the pair. This is the assertion the LIVE
    // estate could not carry: measured 2026-09-08, its 17 desks produced three
    // of the four and `unpushed-commits` never.
    const answered = new Set(cases.map((one) => one.row.refusal));
    expect([...answered].sort()).toEqual([
      '', 'blocked-marker', 'uncommitted-changes', 'unpushed-commits',
    ]);
    // And each reading the rule takes must vary, or it is being asked one
    // question repeatedly.
    expect(cases.some((one) => one.row.blockedMarker)).toBe(true);
    expect(cases.some((one) => one.row.dirtyPath !== '')).toBe(true);
    expect(cases.some((one) => one.row.ahead === 'unknown')).toBe(true);
    expect(cases.some((one) => one.row.ahead === 0)).toBe(true);
    expect(cases.some((one) => typeof one.row.ahead === 'number' && one.row.ahead > 0)).toBe(true);
  });

  it('answers what the shell answers, on every desk', () => {
    const found: Disagreement[] = [];
    for (const one of cases) {
      compareField(found, one.name, 'refusal', ruleVerdict(one.row), one.row.refusal);
    }
    // ONE comparison rather than an assertion per desk: one desk disagreeing
    // and every desk disagreeing are different findings pointing at different
    // bugs, and a failure has to name which.
    expect(found.map(report)).toEqual([]);
  });

  it('declines to refuse where the reading could not be taken, on both sides', () => {
    // A branch with no upstream reaches the loop only when its claim push never
    // happened, and that desk's own commits are the claim commit the next reset
    // would rewrite. `unknown` is a reading and not a refusal — asserted on the
    // SHELL's answer too, because this is the case where a wrong rule strands a
    // desk forever rather than losing one.
    const noUpstream = cases.find((one) => one.name === 'no-upstream');
    expect(noUpstream?.row.ahead).toBe('unknown');
    expect(noUpstream?.row.refusal).toBe('');
    expect(ruleVerdict(noUpstream!.row)).toBe('');
  });

  it('names the marker first on a desk that holds both, on both sides', () => {
    // The ORDER is compared and not only the verdict, because the loop logs one
    // line and the order decides which condition an operator is sent to fix.
    const both = cases.find((one) => one.name === 'marker-over-dirty');
    expect(both?.row.refusal).toBe('blocked-marker');
    expect(ruleVerdict(both!.row)).toBe('blocked-marker');
  });

  it('reports a disagreement naming the subject and both answers', () => {
    // THE REPORT IS THE DELIVERABLE, so it is asserted rather than assumed.
    const line = report({
      subject: 'blocked-marker',
      field: 'refusal',
      adapter: '"uncommitted-changes"',
      production: '"blocked-marker"',
    });
    expect(line).toBe(
      'blocked-marker :: refusal :: rule="uncommitted-changes" shell="blocked-marker"',
    );
  });
});
