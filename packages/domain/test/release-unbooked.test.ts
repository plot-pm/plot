import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Finding } from '../src/entities/finding.js';
import type { ReleaseChangeset } from '../src/rules/release-prepare.js';
import {
  releaseOwes,
  releaseScope,
  releaseScopeSprintOf,
  sprintStatusField,
  type ReleaseScopePlan,
  type ReleaseScopeSprint,
} from '../src/rules/release-scope.js';
import {
  RELEASE_UNBOOKED_BRANCH,
  releaseUnbooked,
  releaseUnbookedDiff,
  releaseUnbookedEvidence,
  releaseUnbookedOfEvidence,
  releaseUnbookedShown,
  type ReleaseUnbooked,
  type ReleaseUnbookedReadings,
} from '../src/rules/release-unbooked.js';
import { releaseFinish, type ScopePlan } from '../src/workflows/release-finish.js';

// The repository as `v2.36.0` (d9d5e9229) left it: both sprints naming
// `Release: 2.36.0`, the 74 changesets the release merge removed, and the
// phase of every plan they name, all read at the tag.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'release-2-36-0');
const SPRINT_FILES = ['2026-W47-triggers-and-connectors.md', '2026-W47-delivery-ui-polish.md'];
const fixtureSprints = (): ReleaseScopeSprint[] =>
  SPRINT_FILES.map((name) => releaseScopeSprintOf(`docs/sprints/${name}`, readFileSync(join(FIXTURE, name), 'utf8')));
const fixtureShipped = (): ReleaseChangeset[] => JSON.parse(readFileSync(join(FIXTURE, 'changesets.json'), 'utf8'));
const fixturePlans = (): ScopePlan[] => JSON.parse(readFileSync(join(FIXTURE, 'plans.json'), 'utf8'));

const SPRINT_DELIVERED = [
  'delivery-link-tuples-everywhere',
  'every-delivery-section-folds',
  'folded-sections-summarise-visually',
  'delivery-tab-has-one-header',
  'delivery-rows-act-from-one-place',
  'tickets-show-what-the-sprint-delivers-and-found',
  'delivery-activity-has-three-signals',
  'delivery-sections-count-alike',
  'templates-show-named-identifiers',
];

const fixture = (over: Partial<ReleaseUnbookedReadings> = {}): ReleaseUnbookedReadings => ({
  tag: { tag: 'v2.36.0', date: '2026-11-23' },
  sprints: fixtureSprints(),
  plans: fixturePlans(),
  shipped: fixtureShipped(),
  ...over,
});

const plan = (slug: string, over: Partial<ReleaseScopePlan> = {}): ReleaseScopePlan => ({
  slug,
  file: `docs/plans/2026-11-01-${slug}.md`,
  phase: 'delivered',
  releasedRecord: '',
  ...over,
});

const sprint = (over: Partial<ReleaseScopeSprint> = {}): ReleaseScopeSprint => ({
  slug: 'w47',
  state: 'Closed',
  start: '2026-11-11',
  release: '2.36.0',
  slugs: ['a'],
  ...over,
});

describe('releaseUnbooked — the 2.36.0 release', () => {
  it('reads both sprints that name the version and names the plans each owes', () => {
    const sprints = fixtureSprints();
    expect(sprints.map((s) => [s.slug, s.state, s.release])).toEqual([
      ['triggers-and-connectors', 'Closed', '2.36.0'],
      ['delivery-ui-polish', 'Active', '2.36.0'],
    ]);
    const out = releaseUnbooked(fixture());
    if (out === 'none' || out === 'unaskable') throw new Error(out);
    expect(out.version).toBe('v2.36.0');
    expect(out.sprintOpen).toBe('delivery-ui-polish');
    // The closed sprint's two plans were Released in v2.34.0 and owe nothing.
    expect(out.plans).not.toContain('bitbucket-and-jira-read-in-process');
    expect(out.plans.slice(0, SPRINT_DELIVERED.length)).toEqual(SPRINT_DELIVERED);
    // A plan a changeset names outside both sprints, Delivered at the tag.
    expect(out.plans).toContain('the-controller-gate-reads-every-command-segment');
    // A named plan that read Approved at the tag is not counted.
    expect(out.plans).not.toContain('fleet-state-is-read-whole-and-from-one-home');
    expect(out.plans).toHaveLength(21);
  });

  it('counts a closed sprint of the version as scope', () => {
    const out = releaseUnbooked({
      tag: { tag: 'v2.36.0', date: '2026-11-23' },
      sprints: [sprint({ slugs: ['a'] }), sprint({ slug: 'w48', state: 'Active', release: '2.36.1', slugs: ['b'] })],
      plans: [plan('a'), plan('b')],
      shipped: [],
    });
    expect(out).toEqual({ version: 'v2.36.0', plans: ['a'], sprintOpen: null });
  });

  it('counts a docs-type plan that only a removed changeset names', () => {
    const out = releaseUnbooked({
      tag: { tag: 'v2.36.0', date: '2026-11-23' },
      sprints: [sprint({ slugs: [] })],
      plans: [{ ...plan('docs-only'), type: 'docs' } as ReleaseScopePlan],
      shipped: [{ file: 'docs-only.md', plan: 'docs/plans/2026-11-01-docs-only.md' }],
    });
    expect(out).toEqual({ version: 'v2.36.0', plans: ['docs-only'], sprintOpen: null });
  });

  it('answers none for a fully booked release', () => {
    const plans = fixturePlans().map((p) =>
      p.phase === 'delivered' ? { ...p, phase: 'released', releasedRecord: '2026-11-23, v2.36.0' } : p,
    );
    const sprints = fixtureSprints().map((s) => ({ ...s, state: 'Closed' }));
    expect(releaseUnbooked(fixture({ plans, sprints }))).toBe('none');
  });

  it('answers none where the repository holds no release tag', () => {
    expect(releaseUnbooked(fixture({ tag: 'none' }))).toBe('none');
  });

  it('answers an open sprint with no plan owed', () => {
    const out = releaseUnbooked({
      tag: { tag: 'v2.36.0', date: '2026-11-23' },
      sprints: [sprint({ state: 'Active', slugs: [] })],
      plans: [],
      shipped: [],
    });
    expect(out).toEqual({ version: 'v2.36.0', plans: [], sprintOpen: 'w47' });
  });

  it.each(['tag', 'sprints', 'plans', 'shipped'] as const)('answers unaskable where the %s read failed', (read) => {
    expect(releaseUnbooked(fixture({ [read]: 'unaskable' }))).toBe('unaskable');
  });
});

// The repository as `v2.37.0` (a55df0f41) left it: no sprint names 2.37.0 and
// the active sprint names 2.38.0.
describe('releaseUnbooked — the 2.37.0 release', () => {
  const AT = join(import.meta.dirname, 'fixtures', 'release-2-37-0');
  const SPRINT = '2026-W47-plot-describes-itself.md';

  it('names the 10 changeset-named plans and no open sprint', () => {
    const answer = releaseUnbooked({
      tag: { tag: 'v2.37.0', date: '2026-11-27' },
      sprints: [releaseScopeSprintOf(`docs/sprints/${SPRINT}`, readFileSync(join(AT, SPRINT), 'utf8'))],
      plans: JSON.parse(readFileSync(join(AT, 'plans.json'), 'utf8')),
      shipped: JSON.parse(readFileSync(join(AT, 'changesets.json'), 'utf8')),
    });
    if (typeof answer === 'string') throw new Error(answer);
    expect(answer.plans).toHaveLength(10);
    expect(answer.sprintOpen).toBeNull();
  });
});

describe('releaseUnbooked and releaseFinish — one scope', () => {
  it('name the same plans for the same readings', () => {
    const r = fixture();
    const out = releaseUnbooked(r);
    if (out === 'none' || out === 'unaskable') throw new Error(out);
    const sprints = fixtureSprints().map((s) => ({
      ...s,
      file: `docs/sprints/2026-W47-${s.slug}.md`,
      link: s.state === 'Closed' ? '' : `docs/sprints/active/${s.slug}.md`,
    }));
    const finish = releaseFinish(
      { caller: 'person', version: '2.36.0', tagExists: true, tagDate: '2026-11-23', plans: fixturePlans(), shipped: fixtureShipped(), sprints },
      { on: '2026-11-24' },
    );
    if (finish.outcome === 'refused') throw new Error(finish.detail);
    expect(finish.detail.booked).toEqual(out.plans);
    expect(finish.detail.closeSprint?.slug).toBe(out.sprintOpen);
  });
});

describe('releaseUnbookedDiff — the channel slot', () => {
  const NOW = '2026-11-24T10:00:00.000Z';
  const owed = { version: 'v2.36.0', plans: ['a', 'b'], sprintOpen: null };

  it('publishes an owed release once and not again with the same evidence', () => {
    const first = releaseUnbookedDiff([], owed, NOW);
    expect(first.publish).toEqual([
      {
        monitor: 'ReleaseMonitor',
        branch: RELEASE_UNBOOKED_BRANCH,
        worktree: '',
        finding: 'release unbooked',
        since: NOW,
        evidence: 'v2.36.0: 2 plan(s) unbooked (a, b)',
        measuredAt: NOW,
      },
    ]);
    expect(releaseUnbookedDiff(first.publish, owed, NOW)).toEqual({ publish: [], clear: [] });
  });

  it('retracts a held finding on none, and touches nothing on unaskable', () => {
    const held: Finding[] = [...releaseUnbookedDiff([], owed, NOW).publish];
    expect(releaseUnbookedDiff(held, 'unaskable', NOW)).toEqual({ publish: [], clear: [] });
    const { clear } = releaseUnbookedDiff(held, 'none', NOW);
    expect(clear).toMatchObject([{ monitor: 'ReleaseMonitor', finding: 'clear' }]);
    expect(releaseUnbookedDiff([], 'none', NOW)).toEqual({ publish: [], clear: [] });
  });
});

describe('releaseScope — the sprints and plans of a release', () => {
  it('admits an open unnamed sprint that starts on or before the tag date, or has no start', () => {
    const sprints = [
      sprint({ slug: 'no-start', state: 'Active', release: '', start: '' }),
      sprint({ slug: 'before', state: 'Active', release: '', start: '2026-11-20' }),
      sprint({ slug: 'on', state: 'Active', release: '', start: '2026-11-23' }),
      sprint({ slug: 'after', state: 'Active', release: '', start: '2026-11-30' }),
      sprint({ slug: 'closed', state: 'Closed', release: '', start: '2026-11-01' }),
    ];
    const scope = releaseScope('v2.36.0', '2026-11-23T09:00:00Z', sprints, []);
    expect(scope.sprints.map((s) => s.slug)).toEqual(['no-start', 'before', 'on']);
  });

  it('owes a Released sprint plan its record, and never a Released plan only a changeset names', () => {
    const released = plan('a', { phase: 'released' });
    expect(releaseOwes(released, true)).toBe(true);
    expect(releaseOwes(released, false)).toBe(false);
  });

  it('reads a sprint file with no Status section as empty fields, its slug from a bare file name', () => {
    expect(releaseScopeSprintOf('2026-W47-w47.md', '# W47\n')).toEqual({ slug: 'w47', state: '', start: '', release: '', slugs: [] });
  });

  it('answers the first field name the Status section holds, and empty where it holds none', () => {
    const content = '## Status\n- **Phase:** Active\n';
    expect(sprintStatusField(content, ['State', 'Phase'])).toBe('Active');
    expect(sprintStatusField(content, ['Release'])).toBe('');
  });
});

describe('releaseUnbookedEvidence — the finding line', () => {
  it('names an open sprint and omits the plan list where no plan is owed', () => {
    expect(releaseUnbookedEvidence({ version: 'v2.36.0', plans: [], sprintOpen: 'w47' })).toBe('v2.36.0: 0 plan(s) unbooked; sprint w47 open');
  });
});

describe('the evidence read back', () => {
  const cases: ReleaseUnbooked[] = [
    { version: 'v2.36.0', plans: ['alpha', 'beta', 'manual'], sprintOpen: '2026-w46' },
    { version: 'v2.36.0', plans: ['alpha'], sprintOpen: null },
    { version: 'v2.36.0', plans: [], sprintOpen: '2026-w46' },
  ];

  it.each(cases)('reads back what releaseUnbookedEvidence wrote: %o', (answer) => {
    expect(releaseUnbookedOfEvidence(releaseUnbookedEvidence(answer))).toEqual(answer);
  });

  it('answers null for a line of another form, or a count that does not match its slugs', () => {
    expect(releaseUnbookedOfEvidence('release unbooked no longer holds')).toBeNull();
    expect(releaseUnbookedOfEvidence('v2.36.0: 3 plan(s) unbooked (alpha, beta)')).toBeNull();
  });
});

describe('the answer the board shows', () => {
  const finding = (over: Partial<Finding> = {}): Finding => ({
    monitor: 'ReleaseMonitor',
    branch: RELEASE_UNBOOKED_BRANCH,
    worktree: '',
    finding: 'release unbooked',
    since: '2026-11-24T10:00:00Z',
    evidence: 'v2.36.0: 1 plan(s) unbooked (alpha); sprint 2026-w46 open',
    measuredAt: '2026-11-24T10:00:00Z',
    ...over,
  });
  const never = (): never => { throw new Error('the board read its own answer'); };

  it('takes fleetd\'s finding while fleetd is live, and reads nothing itself', () => {
    expect(releaseUnbookedShown([finding()], never)).toEqual({
      answer: { version: 'v2.36.0', plans: ['alpha'], sprintOpen: '2026-w46' },
      source: 'fleetd',
    });
  });

  it('answers none from a live fleetd that holds no release unbooked finding', () => {
    expect(releaseUnbookedShown([finding({ monitor: 'BuildMonitor' })], never)).toEqual({ answer: 'none', source: 'fleetd' });
  });

  it('answers unaskable where the evidence does not read, never none', () => {
    expect(releaseUnbookedShown([finding({ evidence: 'garbled' })], never)).toEqual({ answer: 'unaskable', source: 'fleetd' });
  });

  it('asks the rule itself where no fleetd heartbeat is live', () => {
    expect(releaseUnbookedShown(null, () => 'unaskable')).toEqual({ answer: 'unaskable', source: 'board' });
  });
});
