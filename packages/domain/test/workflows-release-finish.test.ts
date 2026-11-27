import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ReleaseChangeset } from '../src/rules/release-prepare.js';
import { releaseScopeSprintOf } from '../src/rules/release-scope.js';
import { releaseFinish, type FinishSprint, type ReleaseFinishReadings, type ScopePlan } from '../src/workflows/release-finish.js';

const plan = (slug: string, over: Partial<ScopePlan> = {}): ScopePlan => ({
  slug,
  file: `docs/plans/2026-10-01-${slug}.md`,
  type: 'feature',
  phase: 'delivered',
  releasedRecord: '',
  ...over,
});

const sprint = (over: Partial<FinishSprint> = {}): FinishSprint => ({
  slug: 'w44',
  file: 'docs/sprints/2026-w44.md',
  link: 'docs/sprints/active/2026-w44.md',
  state: 'Active',
  start: '2026-10-20',
  release: '',
  slugs: undefined as unknown as readonly string[],
  ...over,
});

/** The finish's readings; `scope` is the sprint's plans and `outside` every other plan file. */
type Over = Partial<ReleaseFinishReadings> & { scope?: ScopePlan[]; outside?: ScopePlan[] };

const readings = (over: Over = {}): ReleaseFinishReadings => {
  const { scope = [plan('a'), plan('b', { type: 'docs' }), plan('c', { type: 'infra' })], outside = [], ...rest } = over;
  const sprints = (rest.sprints ?? [sprint()]).map((s) => (s.slugs === undefined ? { ...s, slugs: scope.map((p) => p.slug) } : s));
  return {
    caller: 'person',
    version: 'v2.30.0',
    tagExists: true,
    tagDate: '',
    shipped: [],
    ...rest,
    plans: rest.plans ?? [...scope, ...outside],
    sprints,
  };
};

const input = { on: '2026-10-30' };

const reasonOf = (r: ReleaseFinishReadings) => {
  const out = releaseFinish(r, input);
  return out.outcome === 'refused' ? out.reason : out.outcome;
};

describe('releaseFinish — books a release in one commit', () => {
  it('refuses an unattended caller and a fleetd caller', () => {
    expect(reasonOf(readings({ caller: 'unattended' }))).toBe('unattended');
    expect(reasonOf(readings({ caller: 'fleetd' }))).toBe('unattended');
  });

  it('refuses tag-absent and writes nothing', () => {
    const out = releaseFinish(readings({ tagExists: false }), input);
    expect(out.outcome).toBe('refused');
    expect(out).toMatchObject({ reason: 'tag-absent' });
  });

  it('books docs and infra plans as Released with the others', () => {
    const out = releaseFinish(readings(), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    const phases = out.writes.filter((w) => w.kind === 'plan-phase').map((w) => w.file);
    expect(phases).toHaveLength(3);
  });

  it('writes one commit and one push, with the sprint close in that commit', () => {
    const out = releaseFinish(readings(), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    const commits = out.writes.filter((w) => w.kind === 'commit');
    expect(commits).toHaveLength(1);
    expect(out.writes.filter((w) => w.kind === 'push')).toHaveLength(1);
    expect(out.detail.closeSprint).toEqual({
      slug: 'w44',
      file: 'docs/sprints/2026-w44.md',
      link: 'docs/sprints/active/2026-w44.md',
      actualEnd: '2026-10-30',
    });
    expect(commits[0]).toMatchObject({
      paths: expect.arrayContaining(['docs/sprints/2026-w44.md', 'docs/sprints/active/2026-w44.md']),
    });
  });

  it('records each plan with the date and the version', () => {
    const out = releaseFinish(readings({ scope: [plan('a')] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.writes).toContainEqual({
      kind: 'plan-record',
      file: 'docs/plans/2026-10-01-a.md',
      field: 'Released',
      value: '2026-10-30, v2.30.0',
    });
  });

  it('answers already-released and writes nothing on a second run', () => {
    const done = readings({
      scope: [plan('a', { phase: 'released', releasedRecord: '2026-10-30, v2.30.0' })],
      sprints: [sprint({ state: 'Closed' })],
    });
    expect(reasonOf(done)).toBe('already-released');
  });

  it('books only the plans not yet released and still closes an open sprint', () => {
    const half = readings({
      scope: [plan('a', { phase: 'released', releasedRecord: '2026-10-30, v2.30.0' }), plan('b')],
    });
    const out = releaseFinish(half, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['b']);
    expect(out.detail.closeSprint).toMatchObject({ slug: 'w44' });
  });

  it('stops before any write and names a scope plan that is not delivered', () => {
    const out = releaseFinish(readings({ scope: [plan('a'), plan('d', { phase: 'approved' })] }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-unbookable' });
    if (out.outcome === 'refused') expect(out.detail).toContain('d');
  });

  it('names a scope plan whose file is missing', () => {
    const out = releaseFinish(readings({ scope: [plan('e', { file: '' })] }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-unbookable' });
  });

  it('names a sprint slug that no plan file carries as having no plan file', () => {
    const out = releaseFinish(readings({ scope: [plan('a')], sprints: [sprint({ slugs: ['a', 'zz'] })] }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'plan-unbookable' });
    if (out.outcome === 'refused') expect(out.detail).toContain('zz (no plan file)');
  });

  it('names the sprint file where the active index names none', () => {
    const unlinked = (slug: string) => sprint({ slug, file: `docs/sprints/2026-${slug}.md`, link: '' });
    const ambiguous = releaseFinish(readings({ sprints: [unlinked('w44'), unlinked('w46')] }), input);
    expect(ambiguous).toMatchObject({ outcome: 'refused', reason: 'sprint-ambiguous' });
    if (ambiguous.outcome === 'refused') expect(ambiguous.detail).toContain('docs/sprints/2026-w44.md, docs/sprints/2026-w46.md');
  });

  it('books with no sprint to close, from the shipped changesets alone', () => {
    const shipped = ['a', 'b', 'c'].map((slug) => ({ file: `${slug}.md`, plan: `docs/plans/2026-10-01-${slug}.md` }));
    const out = releaseFinish(readings({ sprints: [], shipped }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.closeSprint).toBeNull();
    expect(out.writes.find((w) => w.kind === 'commit')).toMatchObject({
      paths: ['docs/plans/2026-10-01-a.md', 'docs/plans/2026-10-01-b.md', 'docs/plans/2026-10-01-c.md'],
    });
  });

  it('refuses sprint-ambiguous when two open sprints are in scope, naming both', () => {
    const two = readings({ sprints: [sprint(), sprint({ slug: 'w46', link: 'docs/sprints/active/2026-w46.md' })] });
    const out = releaseFinish(two, input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'sprint-ambiguous' });
    if (out.outcome === 'refused') {
      expect(out.detail).toContain('docs/sprints/active/2026-w44.md');
      expect(out.detail).toContain('docs/sprints/active/2026-w46.md');
    }
  });

  it('books the shipped changesets and notes an active sprint naming another version, leaving it open', () => {
    const shipped = [{ file: 'x.md', plan: 'docs/plans/2026-10-01-x.md' }];
    const out = releaseFinish(readings({ sprints: [sprint({ release: '2.31.0' })], outside: [plan('x')], shipped }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['x']);
    expect(out.detail.closeSprint).toBeNull();
    expect(out.detail.notes).toContain('open sprint w44 names 2.31.0; left open');
  });

  it('ignores an open sprint naming another version where another open sprint is in scope', () => {
    const two = readings({
      sprints: [sprint({ release: '2.31.0' }), sprint({ slug: 'w46', file: 'docs/sprints/2026-w46.md', link: 'docs/sprints/active/2026-w46.md' })],
    });
    const out = releaseFinish(two, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.closeSprint).toMatchObject({ slug: 'w46' });
  });

  it('refuses sprint-ambiguous where two open sprints name the version', () => {
    const two = readings({
      sprints: [sprint({ release: '2.30.0' }), sprint({ slug: 'w46', link: 'docs/sprints/active/2026-w46.md', release: '2.30.0' })],
    });
    expect(reasonOf(two)).toBe('sprint-ambiguous');
  });

  it('does not refuse plan-unbookable for an Approved plan of a sprint naming another version', () => {
    const other = readings({
      scope: [plan('a'), plan('d', { phase: 'approved' })],
      sprints: [sprint({ release: '2.31.0' })],
    });
    expect(reasonOf(other)).toBe('already-released');
  });

  it('matches 2.30.0 against v2.30.0, ignoring the leading v on both sides', () => {
    const out = releaseFinish(readings({ version: 'v2.30.0', sprints: [sprint({ release: '2.30.0' })] }), input);
    expect(out.outcome).toBe('decided');
  });

  it('does not refuse a sprint with no Release field', () => {
    const out = releaseFinish(readings({ sprints: [sprint({ release: '' })] }), input);
    expect(out.outcome).toBe('decided');
  });

  it('closes a Committed sprint through the sprint transition, its state word trimmed', () => {
    const out = releaseFinish(readings({ sprints: [sprint({ state: ' Committed ' })] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.closeSprint).toMatchObject({ actualEnd: '2026-10-30' });
  });

  it('refuses sprint-unclosable with the transition rule that fired', () => {
    const planned = releaseFinish(readings({ sprints: [sprint({ state: 'Planned' })] }), input);
    expect(planned).toMatchObject({ outcome: 'refused', reason: 'sprint-unclosable' });
    if (planned.outcome === 'refused') expect(planned.detail).toContain('state-unrecognised');
    const early = releaseFinish(readings({ sprints: [sprint({ start: '2026-11-01' })] }), input);
    expect(early).toMatchObject({ outcome: 'refused', reason: 'sprint-unclosable' });
    if (early.outcome === 'refused') expect(early.detail).toContain('close-date-before-start');
  });
});

describe('releaseFinish — plans outside the sprint', () => {
  const named = (slug: string) => ({ file: `${slug}.md`, plan: `docs/plans/2026-10-01-${slug}.md` });
  const notesOf = (r: ReleaseFinishReadings): readonly string[] => {
    const out = releaseFinish(r, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    return out.detail.notes;
  };

  it('books a Delivered plan outside the sprint that a shipped changeset names', () => {
    const out = releaseFinish(readings({ outside: [plan('x')], shipped: [named('x')] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c', 'x']);
    expect(out.detail.notes).toEqual([]);
    expect(out.writes.filter((w) => w.kind === 'plan-phase').map((w) => w.file)).toContain('docs/plans/2026-10-01-x.md');
  });

  it('names a Delivered plan no changeset names and does not book it', () => {
    const r = readings({ outside: [plan('y')] });
    const out = releaseFinish(r, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    expect(notesOf(r).join('\n')).toContain('not booked: y');
  });

  it('skips and names a named Approved plan and a named missing path, and still books the scope', () => {
    const r = readings({
      outside: [plan('p', { phase: 'approved' })],
      shipped: [named('p'), named('ghost')],
    });
    const out = releaseFinish(r, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    const text = notesOf(r).join('\n');
    expect(text).toContain('p (phase approved)');
    expect(text).toContain('ghost (no plan file)');
  });

  it('names nothing for a named Delivered plan that already holds its Released record', () => {
    const r = readings({ outside: [plan('r', { releasedRecord: '2026-09-01, v2.29.0' })], shipped: [named('r')] });
    const out = releaseFinish(r, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    expect(out.detail.notes).toEqual([]);
  });

  it('books the scope and names shipped-unread where the changesets are unaskable', () => {
    const r = readings({ outside: [plan('x')], shipped: 'unaskable' });
    const out = releaseFinish(r, input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    expect(notesOf(r).join('\n')).toContain('shipped-unread');
    expect(notesOf(r).join('\n')).toContain('not booked: x');
  });

  it('matches a plan: path to the scope through its slug', () => {
    const out = releaseFinish(readings({ shipped: [named('a')] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
  });
});

describe('releaseFinish — a closed sprint names the version', () => {
  const closed = (over: Partial<FinishSprint> = {}) =>
    sprint({ slug: 'w47', file: 'docs/sprints/2026-w47.md', link: '', state: 'Closed', release: '2.30.0', ...over });

  it('books a closed sprint\'s scope and leaves the sprint closed', () => {
    const out = releaseFinish(readings({ sprints: [closed()] }), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    expect(out.detail.closeSprint).toBeNull();
  });

  it('answers already-released on a second run', () => {
    const done = readings({
      scope: ['a', 'b', 'c'].map((slug) => plan(slug, { phase: 'released', releasedRecord: '2026-10-30, v2.30.0' })),
      sprints: [closed()],
    });
    expect(reasonOf(done)).toBe('already-released');
  });

  it('books a closed sprint while an active sprint names the next version', () => {
    const out = releaseFinish(
      readings({ sprints: [closed(), sprint({ slug: 'w48', release: '2.31.0', slugs: ['z'] })], outside: [plan('z', { phase: 'approved' })] }),
      input,
    );
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(['a', 'b', 'c']);
    expect(out.detail.closeSprint).toBeNull();
  });

  it('does not refuse for a closed sprint that names another version', () => {
    const out = releaseFinish(readings({ sprints: [closed({ release: '2.29.0', slugs: ['old'] }), closed()] }), input);
    expect(out.outcome).toBe('decided');
  });

  it('notes an active sprint naming another version and does not note a closed one', () => {
    const shipped = [{ file: 'x.md', plan: 'docs/plans/2026-10-01-x.md' }];
    const notesFor = (s: FinishSprint) => {
      const out = releaseFinish(readings({ sprints: [s], scope: [], outside: [plan('x')], shipped }), input);
      if (out.outcome === 'refused') throw new Error(out.detail);
      return out.detail.notes;
    };
    expect(notesFor(closed({ release: '2.31.0' }))).toEqual([]);
    expect(notesFor(sprint({ release: '2.31.0' }))).toEqual(['open sprint w44 names 2.31.0; left open']);
  });
});

// The repository as `v2.37.0` (a55df0f41) left it: the active sprint
// `plot-describes-itself` naming `Release: 2.38.0`, the 15 changesets the
// release merge removed, and the 10 plans their `plan:` lines name, read at the tag.
describe('releaseFinish — no sprint names the version (the 2.37.0 fixture)', () => {
  const FIXTURE = join(import.meta.dirname, 'fixtures', 'release-2-37-0');
  const SPRINT = '2026-W47-plot-describes-itself.md';
  const shipped = (): ReleaseChangeset[] => JSON.parse(readFileSync(join(FIXTURE, 'changesets.json'), 'utf8'));
  const plans = (): ScopePlan[] => JSON.parse(readFileSync(join(FIXTURE, 'plans.json'), 'utf8'));
  const sprints = (): FinishSprint[] => [
    {
      ...releaseScopeSprintOf(`docs/sprints/${SPRINT}`, readFileSync(join(FIXTURE, SPRINT), 'utf8')),
      file: `docs/sprints/${SPRINT}`,
      link: 'docs/sprints/active/plot-describes-itself.md',
    },
  ];
  const at237 = (over: Partial<ReleaseFinishReadings> = {}): ReleaseFinishReadings => ({
    caller: 'person',
    version: '2.37.0',
    tagExists: true,
    tagDate: '2026-11-27',
    plans: plans(),
    shipped: shipped(),
    sprints: sprints(),
    ...over,
  });
  const NAMED = [
    'a-refused-bb-call-writes-no-budget-row',
    'delivery-is-measured-from-the-plan-files',
    'shell-scripts-refuse-a-second-mode-and-name-the-fetch',
    'plot-init-checks-for-the-bb-cli',
    'the-bb-pause-rule-follows-bb-1-15-2',
    'the-board-refuses-unauthenticated-remote-writes',
    'the-checklist-badge-reads-the-newest-release',
    'the-default-runner-has-a-spend-cap',
    'github-refuses-a-merge-into-a-red-main',
    'fleetctl-runs-in-a-submodule-checkout',
  ];

  it('reads 15 changesets, 12 naming 10 distinct plans, against an active sprint naming 2.38.0', () => {
    const cs = shipped();
    expect(cs).toHaveLength(15);
    expect(cs.filter((c) => c.plan !== '')).toHaveLength(12);
    expect(sprints()[0]).toMatchObject({ slug: 'plot-describes-itself', state: 'Active', release: '2.38.0' });
  });

  it('books the 10 changeset-named plans in changeset order, closes no sprint and notes plot-describes-itself', () => {
    const out = releaseFinish(at237(), input);
    if (out.outcome === 'refused') throw new Error(out.detail);
    expect(out.detail.booked).toEqual(NAMED);
    expect(out.detail.closeSprint).toBeNull();
    expect(out.detail.notes).toContain('open sprint plot-describes-itself names 2.38.0; left open');
    const commit = out.writes.find((w) => w.kind === 'commit');
    expect(commit).toMatchObject({ message: 'plot: record v2.37.0' });
    const paths = commit !== undefined && 'paths' in commit ? commit.paths : [];
    expect(paths).toHaveLength(10);
    expect(paths.filter((p) => p.startsWith('docs/sprints/'))).toEqual([]);
  });

  it('answers already-released on a re-run with every plan holding its Released record', () => {
    const booked = plans().map((p) => ({ ...p, phase: 'released', releasedRecord: '2026-11-27, v2.37.0' }));
    expect(reasonOf(at237({ plans: booked }))).toBe('already-released');
  });

  it('answers already-released for a sprint-free release whose changesets name no plan', () => {
    const planless = shipped().map((c) => ({ ...c, plan: '' }));
    expect(reasonOf(at237({ shipped: planless }))).toBe('already-released');
    expect(reasonOf(at237({ shipped: planless, sprints: [] }))).toBe('already-released');
  });

  it('refuses shipped-unread where the changesets are unaskable and no sprint is in scope', () => {
    const out = releaseFinish(at237({ shipped: 'unaskable' }), input);
    expect(out).toMatchObject({ outcome: 'refused', reason: 'shipped-unread' });
    if (out.outcome === 'refused') expect(out.detail).toContain('v2.37.0');
  });
});
