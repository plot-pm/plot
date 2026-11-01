import { describe, expect, it } from 'vitest';

import { answered } from '../src/port-result.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import type { BranchReadings } from '../src/rules/branch-state.js';
import { assemblePlanWalk, hasBranchLines } from '../src/workflows/plan-walk-assembly.js';
import type { FleetReadingHeader } from '../src/workflows/plan-walk-assembly.js';
import type { BranchStageReadings, PrDetail } from '../src/workflows/plan-walk-branches.js';
import type { Estate } from '../src/workflows/plan-walk-estate.js';
import { planReport, reportBanner, reportFooter, reportNotes } from '../src/workflows/plan-walk-report.js';
import type { ReportContext } from '../src/workflows/plan-walk-report.js';

const plan = (file: string, branches: string[]): PlanRecord =>
  ({
    file,
    phase: 'approved',
    type: 'feature',
    slices: [
      {
        name: 'slice-1',
        branches: branches.map((branch) => ({ branch, deferred: false, deferredReason: '', claimed: '', waitsOn: [] })),
      },
    ],
  }) as unknown as PlanRecord;

const wip: BranchReadings = {
  deferredByPlan: false,
  refTip: 't1',
  mainTip: 'm1',
  mergeSubjectFound: false,
  hostReach: 'ok',
  pr: 'none',
  prListComplete: true,
  commitsAhead: 1,
  realCommitsAhead: 1,
  waits: [],
};

const assemble = (records: PlanRecord[], detail: PrDetail | undefined, loose?: { verifiable: boolean }) => {
  const estate = { mainSha: 'm1', plans: records.map((record) => ({ blob: 'b', record })), indexes: [], dangling: [] };
  const branches = {
    mainSha: 'm1',
    backend: 'github',
    origin: '',
    merges: [],
    added: new Map(),
    branches: records.flatMap((r) =>
      r.slices.flatMap((s) =>
        s.branches.map((b) => ({ plan: r.file, branch: b.branch, readings: wip, landed: [], changedPaths: [], prDetail: detail })),
      ),
    ),
  } as unknown as BranchStageReadings;
  const result = assemblePlanWalk(
    {
      estate: answered(estate as unknown as Estate),
      branches: answered(branches),
      desks: answered({ mainSha: 'm1', desks: [] }),
    },
    { slug: '', offer: false, ...(loose === undefined ? {} : { loose }) },
  );
  if (!result.ok) throw new Error('walk failed');
  return result.value;
};

const header = {
  readRef: 'abc',
  localHead: 'abc',
  main: 'main',
  planDir: 'docs/plans/',
  host: 'ok',
  mergeDetect: 'subject',
  fetchFailed: false,
  fetchError: '',
} as unknown as FleetReadingHeader;

const context: ReportContext = {
  behind: null,
  loose: false,
  looseVerifiable: false,
  offline: false,
  planSource: 'ref',
  subjectPredatesPlan: 0,
};

describe('--loose readiness', () => {
  const degradedOf = (detail: PrDetail | undefined) =>
    assemble([plan('docs/plans/p.md', ['feature/a'])], detail, { verifiable: true }).plans[0]!.slices[0]!.looseDegraded;

  it.each([
    ['no host', 'no-host' as PrDetail, ['feature/a(no-host)']],
    ['no detail', undefined, ['feature/a(no-host)']],
    ['an unread cache', 'no-cache' as PrDetail, ['feature/a(no-cache)']],
    ['no PR', 'none' as PrDetail, []],
    ['a closed PR', { state: 'CLOSED', checks: 'green', draft: false } as PrDetail, []],
    ['red checks', { state: 'OPEN', checks: 'red', draft: false } as PrDetail, []],
    ['unknown checks', { state: 'OPEN', checks: 'unknown', draft: false } as PrDetail, ['feature/a(unknown)']],
    ['green checks', { state: 'OPEN', checks: 'green', draft: false } as PrDetail, []],
  ])('degrades %s as expected', (_name, detail, expected) => {
    expect(degradedOf(detail)).toEqual(expected);
  });
});

describe('hasBranchLines', () => {
  it('is false for a plan whose slices name no branch', () => {
    const assembly = assemble([plan('docs/plans/empty.md', []), plan('docs/plans/p.md', ['feature/a'])], undefined);
    expect(assembly.plans.map(hasBranchLines)).toEqual([false, true]);
    expect(assembly.summary.plans).toBe(2);
  });
});

describe('report', () => {
  it('prints the empty-plan block and the plan heading relative to the plan directory', () => {
    const assembly = assemble([plan('docs/plans/empty.md', [])], undefined);
    expect(planReport(assembly.plans[0]!, header, false)).toBe('== empty.md ==\n  (no branches)\n\n');
  });

  it('names the checkout in the banner when it differs from the read ref', () => {
    const moved = { ...header, localHead: 'def' } as FleetReadingHeader;
    expect(reportBanner(moved, { ...context, behind: 3 })).toBe('plot-fleet pulse — abc on origin/main (not your checkout def, 3 behind)\n\n');
  });

  it('prints no note for a fetched ref read, and the offline note for --offline', () => {
    expect(reportNotes(header, context)).toBe('');
    expect(reportNotes(header, { ...context, offline: true })).toContain('--offline skipped the fetch');
  });

  it('ends with the derived-report line and the short summary when no plan exists', () => {
    const assembly = assemble([], undefined);
    expect(reportFooter(assembly, header, context)).toBe(
      'Pulse complete. This report is derived — nothing was changed.\nsummary: plans=0 waves=0 branches=0 claimed=0 claimable=0 eligible=0 blocked=0 deferred=0 waiting=0 prereq_missing=0 main=main\n',
    );
  });
});
