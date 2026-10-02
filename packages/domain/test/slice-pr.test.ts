import { describe, expect, it } from 'vitest';
import {
  MARKER_ONLY_NOTICE,
  isSlicePrRefusal,
  openSlicePr,
  type SlicePrReadings,
} from '../src/rules/slice-pr.js';

const readings = (over: Partial<SlicePrReadings> = {}): SlicePrReadings => ({
  branch: 'feature/a-pr-is-opened-by-a-controller',
  base: 'main',
  planSlug: 'the-master-agent-uses-the-controllers',
  planFile: 'docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md',
  sliceName: "A slice's PR is opened by the fleet, not by hand",
  briefFile: '.plot/briefs/a-pr-is-opened-by-a-controller.md',
  prs: [],
  commits: 3,
  carriedWork: true,
  ...over,
});

describe('openSlicePr', () => {
  it('takes its title from the wave the plan names the branch under', () => {
    const result = openSlicePr(readings(), { draft: false });

    expect(result.outcome).toBe('decided');
    if (isSlicePrRefusal(result)) return;
    expect(result.title).toBe("A slice's PR is opened by the fleet, not by hand");
    expect(result.head).toBe('feature/a-pr-is-opened-by-a-controller');
    expect(result.base).toBe('main');
    expect(result.draft).toBe(false);
  });

  it('opens as a draft where the caller asked for one', () => {
    const result = openSlicePr(readings(), { draft: true });

    if (isSlicePrRefusal(result)) throw new Error('expected a decision');
    expect(result.draft).toBe(true);
  });

  it('states the plan and the brief in the body', () => {
    const result = openSlicePr(readings(), { draft: false });

    if (isSlicePrRefusal(result)) throw new Error('expected a decision');
    expect(result.body).toContain('the-master-agent-uses-the-controllers');
    expect(result.body).toContain('docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md');
    expect(result.body).toContain(".plot/briefs/a-pr-is-opened-by-a-controller.md");
    expect(result.body).toContain("A slice's PR is opened by the fleet, not by hand");
  });

  it('omits the brief line where the slice has none', () => {
    const result = openSlicePr(readings({ briefFile: '' }), { draft: false });

    if (isSlicePrRefusal(result)) throw new Error('expected a decision');
    expect(result.body).not.toContain('Brief:');
    expect(result.body).toContain('the-master-agent-uses-the-controllers');
  });

  describe('the work the branch carries', () => {
    it('says nothing where the branch carries work', () => {
      const result = openSlicePr(readings({ carriedWork: true }), { draft: false });

      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.notice).toBe('carries-work');
      expect(result.body).not.toContain(MARKER_ONLY_NOTICE);
    });

    it('names a branch carrying nothing but a marker, and opens anyway', () => {
      const result = openSlicePr(readings({ carriedWork: false }), { draft: false });

      expect(result.outcome).toBe('decided');
      if (isSlicePrRefusal(result)) return;
      expect(result.notice).toBe('marker-only');
      expect(result.body).toContain(MARKER_ONLY_NOTICE);
    });

    it('claims nothing where the diff could not be read', () => {
      const result = openSlicePr(readings({ carriedWork: 'unknown' }), { draft: false });

      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.notice).toBe('unknown');
      expect(result.body).not.toContain(MARKER_ONLY_NOTICE);
    });
  });

  describe('the four refusals', () => {
    it('refuses a branch no plan names', () => {
      const result = openSlicePr(readings({ planSlug: '', planFile: '' }), { draft: false });

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('plan-unknown');
      expect(result.detail).toContain('feature/a-pr-is-opened-by-a-controller');
    });

    it('refuses a plan that names the branch but no wave', () => {
      const result = openSlicePr(readings({ planFile: '' }), { draft: false });

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('plan-unknown');
    });

    it('refuses a branch listed under no wave heading', () => {
      const result = openSlicePr(readings({ sliceName: '' }), { draft: false });

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('slice-unnamed');
      expect(result.detail).toContain('the-master-agent-uses-the-controllers');
    });

    it('refuses a branch a PR already carries, naming it', () => {
      const result = openSlicePr(
        readings({ prs: [{ number: 840, state: 'OPEN' }] }),
        { draft: false },
      );

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('pr-exists');
      expect(result.detail).toContain('#840');
    });

    it('refuses a MERGED row the same way, naming it', () => {
      const result = openSlicePr(
        readings({ prs: [{ number: 12, state: 'MERGED' }] }),
        { draft: false },
      );

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('pr-exists');
      expect(result.detail).toContain('#12');
    });

    it('refuses a branch holding no commit its base does not', () => {
      const result = openSlicePr(readings({ commits: 0 }), { draft: false });

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('branch-empty');
      expect(result.detail).toContain('main');
    });

    it('refuses a negative commit count the same way', () => {
      const result = openSlicePr(readings({ commits: -1 }), { draft: false });

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('branch-empty');
    });

    it('checks the plan before the wave and the PR before the commits', () => {
      const noPlanNoWave = openSlicePr(
        readings({
          planSlug: '',
          sliceName: '',
          prs: [{ number: 12, state: 'OPEN' }],
          commits: 0,
        }),
        { draft: false },
      );
      const prAndEmpty = openSlicePr(
        readings({ prs: [{ number: 12, state: 'OPEN' }], commits: 0 }),
        { draft: false },
      );

      if (!isSlicePrRefusal(noPlanNoWave)) throw new Error('expected a refusal');
      if (!isSlicePrRefusal(prAndEmpty)) throw new Error('expected a refusal');
      expect(noPlanNoWave.reason).toBe('plan-unknown');
      expect(prAndEmpty.reason).toBe('pr-exists');
    });
  });

  describe('which PR row carries the branch', () => {
    // #1093, measured 2026-09-30 on `bug/a-state-sweep-is-one-request`: PR
    // #1089 was opened, closed 38 s later, and the branch force-pushed, so
    // GitHub refuses to reopen it. A closed PR delivered nothing, so it carries
    // no branch — and the state was in the row the whole time.

    it('opens where the only row is CLOSED, and names it', () => {
      const result = openSlicePr(
        readings({ prs: [{ number: 1089, state: 'CLOSED' }] }),
        { draft: false },
      );

      expect(result.outcome).toBe('decided');
      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.closedPrs).toEqual([1089]);
      expect(result.body).toContain('#1089');
      expect(result.body).toContain('closed unmerged');
    });

    it('names every closed row, in the order the host gave them', () => {
      const result = openSlicePr(
        readings({
          prs: [
            { number: 1089, state: 'CLOSED' },
            { number: 1104, state: 'CLOSED' },
          ],
        }),
        { draft: false },
      );

      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.closedPrs).toEqual([1089, 1104]);
      expect(result.body).toContain('#1089');
      expect(result.body).toContain('#1104');
    });

    it('carries no closed numbers where no row is closed', () => {
      const result = openSlicePr(readings(), { draft: false });

      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.closedPrs).toEqual([]);
    });

    it('leaves the body byte-identical where no row is closed', () => {
      // THE ORDINARY CASE IS UNCHANGED. A closed row is rare; every other PR
      // this estate opens must read exactly as it did.
      const withNoRows = openSlicePr(readings(), { draft: false });
      const withAClosedRowRemoved = openSlicePr(readings({ prs: [] }), { draft: false });

      if (isSlicePrRefusal(withNoRows)) throw new Error('expected a decision');
      if (isSlicePrRefusal(withAClosedRowRemoved)) throw new Error('expected a decision');
      expect(withNoRows.body).toBe(withAClosedRowRemoved.body);
      expect(withNoRows.body).not.toContain('closed unmerged');
    });

    it('refuses an OPEN row whatever its position, so position cannot decide', () => {
      // POSITION DOES NOT MATTER, STATE DOES. The script kept the FIRST
      // matching row, so `[CLOSED, OPEN]` and `[OPEN, CLOSED]` gave different
      // answers for one branch depending on how the host ordered its rows.
      const closedFirst = openSlicePr(
        readings({
          prs: [
            { number: 1089, state: 'CLOSED' },
            { number: 1102, state: 'OPEN' },
          ],
        }),
        { draft: false },
      );
      const openFirst = openSlicePr(
        readings({
          prs: [
            { number: 1102, state: 'OPEN' },
            { number: 1089, state: 'CLOSED' },
          ],
        }),
        { draft: false },
      );

      if (!isSlicePrRefusal(closedFirst)) throw new Error('expected a refusal');
      if (!isSlicePrRefusal(openFirst)) throw new Error('expected a refusal');
      expect(closedFirst.reason).toBe('pr-exists');
      expect(openFirst.reason).toBe('pr-exists');
      expect(closedFirst.detail).toContain('#1102');
      expect(openFirst.detail).toContain('#1102');
    });

    it('refuses a MERGED row sitting behind a CLOSED one, naming the merged number', () => {
      // A fix that searches only for `OPEN` opens a duplicate PR here.
      const result = openSlicePr(
        readings({
          prs: [
            { number: 1089, state: 'CLOSED' },
            { number: 1049, state: 'MERGED' },
          ],
        }),
        { draft: false },
      );

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('pr-exists');
      expect(result.detail).toContain('#1049');
    });

    it('names the first carrying row where several carry', () => {
      const result = openSlicePr(
        readings({
          prs: [
            { number: 1102, state: 'OPEN' },
            { number: 1049, state: 'MERGED' },
          ],
        }),
        { draft: false },
      );

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.detail).toContain('#1102');
    });

    it('refuses a closed-only branch holding no commits on the commits rule', () => {
      // THE REFUSAL ORDER IS FIXED: plan, wave, PR, commits. A closed row is
      // not a PR refusal, so the next rule down is the one that fires.
      const result = openSlicePr(
        readings({ prs: [{ number: 1089, state: 'CLOSED' }], commits: 0 }),
        { draft: false },
      );

      if (!isSlicePrRefusal(result)) throw new Error('expected a refusal');
      expect(result.reason).toBe('branch-empty');
    });
  });

  describe('the day this comes from — 2026-09-08', () => {
    it('a marker-only branch is named at open time rather than at delivery', () => {
      // `the-ci-connector-is-jenkins` merged as #821 carrying a PLOT-BLOCKED.md
      // and nothing else, and its plan read Delivered. The reading existed; no
      // rule asked it while the PR was still being opened.
      const result = openSlicePr(
        readings({
          branch: 'feature/the-ci-connector-is-jenkins',
          planSlug: 'the-build-pipeline-is-its-own-connector',
          planFile: 'docs/plans/2026-09-07-the-build-pipeline-is-its-own-connector.md',
          sliceName: 'The CI connector is Jenkins',
          briefFile: '',
          carriedWork: false,
        }),
        { draft: false },
      );

      if (isSlicePrRefusal(result)) throw new Error('expected a decision');
      expect(result.notice).toBe('marker-only');
      expect(result.body).toContain('deferred:');
    });
  });
});
