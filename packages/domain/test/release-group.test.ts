// The Delivery tab header's Release group: the combined bar, the scope line, the status line and the last release.
import { describe, it, expect } from 'vitest';
import {
  lastRelease,
  noReleaseClause,
  parsePersonDirectory,
  releaseCards,
  releaseGroup,
  releaseStatusLine,
  sprintBarOf,
  NO_RELEASE_TARGETED,
  RELEASE_READING_MISSING,
  type CountedSlice,
  type DeliveryInput,
  type DeliveryReadings,
  type ReleaseGroupSprint,
  type ReleaseRowReading,
  type WorkItemReading,
} from '../src/index.js';
import { APPROVE_PENDING, APPROVE_REGISTER_FIRST, type ReleasePrReading } from '../src/rules/release-approvable.js';
import { compareSemver } from '../src/entities/version.js';

const input: DeliveryInput = { mine: 'off', autoReview: true, correctionBudget: 2 };
const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const member = (slug: string) => ({ slug, tier: 'must' as const, checked: false, known: true });
const sprint = (over: Partial<ReleaseGroupSprint> = {}): ReleaseGroupSprint => ({
  slug: 's1', title: 'Sprint one', release: '2.35.0', ownerHandle: 'jwloka', members: [], ...over,
});
const item = (id: string, extra: Partial<WorkItemReading> = {}): WorkItemReading => ({ id, kind: 'slice', ownership: 'mine', stage: 'queued', ...extra });
const HEAD = 'a'.repeat(40);
const ready: ReleasePrReading = {
  open: true, headSha: HEAD, checksSha: HEAD, ciChecks: 'green',
  plotReview: 'success', plotReviewSha: HEAD, plotReviewJudged: 'success', plotReviewCheckedSha: HEAD,
};
const failing: ReleasePrReading = { ...ready, ciChecks: 'failing' };

// Plan a: one merged slice. Plan b: one blocked, one being built. Plan c: one not started.
const plans = new Map<string, CountedSlice[] | undefined>([
  ['a', [{ id: 'slice:a', merge: 'merged' }]],
  ['b', [{ id: 'slice:b1', merge: 'open' }, { id: 'slice:b2', merge: 'open' }]],
  ['c', [{ id: 'slice:c', merge: 'open' }]],
  ['unread', undefined],
]);
const readings: DeliveryReadings = {
  items: [item('slice:b1', { blockedMarker: true, ownership: 'theirs' }), item('slice:b2', { stage: 'building' }), item('slice:c')],
  agents: [],
};

const groupOf = (
  sprints: ReleaseGroupSprint[],
  rows: ReleaseRowReading[] = [],
  scope: 'release' | 'my-sprint' = 'release',
  last: { tag: string; date: string } | null = null,
) => releaseGroup({
  scope, sprints, rows, directory, slicesByPlan: plans, readings, input, unknownOwners: [], lastRelease: last,
  cards: releaseCards(sprints, rows, directory, plans, readings, input),
});

describe('releaseGroup bar', () => {
  const sprints = [
    sprint({ slug: 'x', release: '2.36.0', members: [member('a'), member('b')] }),
    sprint({ slug: 'y', release: '2.37.0', ownerHandle: 'eins78', members: [member('c')] }),
  ];

  it('sums the per-sprint bars in five segments, being built included', () => {
    const group = groupOf(sprints);
    const per = sprints.map((s) => sprintBarOf(s, plans, readings, input).bar!);
    expect(group.bar!.map((s) => s.state)).toEqual(['delivered', 'blocked', 'at-a-gate', 'being-built', 'not-started']);
    for (const seg of group.bar!) {
      expect(seg.count).toBe(per.reduce((n, bar) => n + bar.find((s) => s.state === seg.state)!.count, 0));
    }
    expect(group.bar!.find((s) => s.state === 'being-built')!.count).toBe(1);
    expect(group.total).toBe(4);
  });

  it('lists the versions of several sprints in the title over one bar', () => {
    expect(groupOf(sprints).title).toBe('2.36.0 · 2.37.0');
  });

  it('draws a grey bar where one sprint is readable and one is not, never a partial count', () => {
    const group = groupOf([sprints[0]!, sprint({ slug: 'z', release: '2.37.0', members: [member('unread')] })]);
    expect(group.readingMissing).toBe(true);
    expect(group.bar).toBeNull();
    expect(group.total).toBe(0);
    expect(releaseStatusLine(group, {}, { registered: true }).text).toBe(RELEASE_READING_MISSING);
  });
});

describe('releaseGroup scope', () => {
  const mine = sprint({ slug: 'mine', title: 'Mine', release: '2.36.0', members: [member('a')] });
  const theirs = sprint({ slug: 'theirs', title: 'Theirs', release: '2.37.0', ownerHandle: 'eins78', members: [member('c')] });
  const rows = [{ id: 'row:37', version: '2.37.0', pr: 37 }];

  it('reads all sprints and their people under release, and the reader sprints under my-sprint', () => {
    const all = groupOf([mine, theirs], rows, 'release');
    const one = groupOf([mine], rows, 'my-sprint');
    expect(all.scopeLine).toBe('all sprints · 2 people');
    expect(all.sprints).toEqual([]);
    expect(one.scopeLine).toBe('my sprint · Mine');
    expect(one.sprints).toEqual([{ slug: 'mine', title: 'Mine' }]);
    expect(one.title).toBe('2.36.0');
    expect(one.total).toBe(1);
    expect(all.total).toBe(2);
    expect(groupOf([mine, theirs], rows, 'my-sprint').scopeLine).toBe('my sprints · Mine, Theirs');
  });

  it('holds under my-sprint only the release its sprints bind, with unboundReason where none binds', () => {
    const one = groupOf([mine], rows, 'my-sprint');
    expect(one.candidates.map((c) => c.version)).toEqual(['2.36.0']);
    const line = releaseStatusLine(one, { 'row:37': ready }, { registered: true });
    expect(line.button).toEqual({ state: 'disabled', reason: 'no release PR carries 2.36.0' });
    expect(line.text).toBe('no release PR carries 2.36.0');
  });

  it('keeps a release row no sprint names under release scope', () => {
    expect(groupOf([], rows, 'release').candidates.map((c) => c.rowId)).toEqual(['row:37']);
  });
});

describe('releaseStatusLine', () => {
  const two = [sprint({ slug: 'x', release: '2.10.0' }), sprint({ slug: 'y', release: '2.9.0' })];
  const rows = [{ id: 'row:10', version: '2.10.0', pr: 310 }, { id: 'row:9', version: '2.9.0', pr: 309 }];

  it('reads "Release PR #N ready" and enables the button, from one result', () => {
    const line = releaseStatusLine(groupOf([sprint()], [{ id: 'r', version: '2.35.0', pr: 300 }]), { r: ready }, { registered: true });
    expect(line.text).toBe('Release PR #300 ready');
    expect(line.button).toEqual({ state: 'enabled', reason: '' });
    expect(line.more).toBeNull();
  });

  it('puts the lowest version by semver in the slot and names the other ready PR', () => {
    const line = releaseStatusLine(groupOf(two, rows), { 'row:10': ready, 'row:9': ready }, { registered: true });
    expect(line.slot.version).toBe('2.9.0');
    expect(line.text).toBe('Release PR #309 ready');
    expect(line.others).toEqual([{ key: 'release:2.10.0', version: '2.10.0', pr: 310 }]);
    expect(line.more).toBe('+1 more ready');
  });

  it('puts the ready PR in the slot where the lower version is not ready', () => {
    const line = releaseStatusLine(groupOf(two, rows), { 'row:10': ready, 'row:9': failing }, { registered: true });
    expect(line.slot.version).toBe('2.10.0');
    expect(line.others).toEqual([]);
    expect(line.button.state).toBe('enabled');
  });

  it('moves the slot to the next version after the first merges', () => {
    const after = groupOf([two[0]!], [rows[0]!]);
    const line = releaseStatusLine(after, { 'row:10': ready }, { registered: true });
    expect(line.slot.version).toBe('2.10.0');
    expect(line.text).toBe('Release PR #310 ready');
  });

  it('shows each releaseApprovable reason as the line and on the disabled button', () => {
    const group = groupOf([sprint()], [{ id: 'r', version: '2.35.0', pr: 300 }]);
    const cases: [ReleasePrReading | null, string][] = [
      [null, 'The board has not read the release PR yet'],
      [{ ...ready, open: false }, 'The release PR is not open'],
      [{ ...ready, headSha: undefined }, "The board has not read the release PR's head yet"],
      [failing, `CI is failing on ${HEAD.slice(0, 9)}`],
      [{ ...ready, plotReview: 'pending', plotReviewJudged: undefined }, `The review is still running on ${HEAD.slice(0, 9)}`],
    ];
    for (const [pr, reason] of cases) {
      const line = releaseStatusLine(group, { r: pr }, { registered: true });
      expect(line.button).toEqual({ state: 'disabled', reason });
      expect(line.text).toBe(reason);
    }
  });

  it('reads a null passkey as unread, not as unregistered', () => {
    const group = groupOf([sprint()], [{ id: 'r', version: '2.35.0', pr: 300 }]);
    const unread = releaseStatusLine(group, { r: ready }, null);
    expect(unread.button).toEqual({ state: 'disabled', reason: APPROVE_PENDING });
    expect(unread.text).toBe(`Release PR #300 ready · ${APPROVE_PENDING}`);
    expect(releaseStatusLine(group, { r: ready }, { registered: false }).button.reason).toBe(APPROVE_REGISTER_FIRST);
  });

  it('keeps the slot with a disabled button where no release is targeted', () => {
    const group = groupOf([sprint({ release: '' })], [], 'release', { tag: 'v2.34.0', date: '2026-11-01' });
    expect(group.kind).toBe('none');
    expect(group.title).toBe(`${NO_RELEASE_TARGETED} · last v2.34.0 2026-11-01`);
    const line = releaseStatusLine(group, {}, { registered: true });
    expect(line.button).toEqual({ state: 'disabled', reason: 'no release PR exists' });
    expect(line.text).toBe('no release PR exists');
  });
});

describe('lastRelease', () => {
  it('answers null where no plan is released, and the clause reads "No release targeted" alone', () => {
    expect(lastRelease([])).toBeNull();
    expect(lastRelease(['', ''])).toBeNull();
    expect(noReleaseClause(null)).toBe(NO_RELEASE_TARGETED);
  });

  it('reads the v form and the bare form, and picks the highest by semver', () => {
    expect(lastRelease(['2026-10-01, v2.9.0', '2026-11-01, 2.10.0'])).toEqual({ tag: 'v2.10.0', date: '2026-11-01' });
  });

  it('reads two releases on one day', () => {
    expect(lastRelease(['2026-11-01, v2.35.0', '2026-11-01, v2.35.1'])).toEqual({ tag: 'v2.35.1', date: '2026-11-01' });
  });

  it('reads the version up to the first space and ignores trailing prose', () => {
    expect(lastRelease(['2026-04-05, v1.0.0-beta.3 — resolved by ancestry rather than by a PR'])).toEqual({ tag: 'v1.0.0-beta.3', date: '2026-04-05' });
  });

  it('puts a pre-release below its release', () => {
    expect(lastRelease(['2026-04-06, v1.0.0', '2026-04-07, v1.0.0-beta.3'])).toEqual({ tag: 'v1.0.0', date: '2026-04-06' });
    expect(compareSemver('v1.0.0-beta.3', 'v1.0.0-beta.10')).toBeLessThan(0);
  });

  it('skips an unparseable record', () => {
    expect(lastRelease(['soon, v3.0.0', '2026-11-01, next', '2026-10-01, v2.0.0'])).toEqual({ tag: 'v2.0.0', date: '2026-10-01' });
  });
});
