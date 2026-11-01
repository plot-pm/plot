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
    ['empty checks', { state: 'OPEN', checks: '', draft: false } as PrDetail, ['feature/a(no-cache)']],
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

describe('report lines', () => {
  const assembled = (records: PlanRecord[], readings: Partial<BranchReadings>, branchOver: Record<string, unknown> = {}) => {
    const estate = { mainSha: 'm1', plans: records.map((record) => ({ blob: 'b', record })), indexes: [], dangling: [] };
    const branches = {
      mainSha: 'm1', backend: 'github', origin: '', merges: [], added: new Map(),
      branches: records.flatMap((r) => r.slices.flatMap((s) => s.branches.map((b) => ({ plan: r.file, branch: b.branch, readings: { ...wip, ...readings }, landed: [], changedPaths: [] })))),
    } as unknown as BranchStageReadings;
    const result = assemblePlanWalk(
      { estate: answered(estate as unknown as Estate), branches: answered(branches), desks: answered({ mainSha: 'm1', desks: [] }) },
      { slug: '', offer: false },
    );
    if (!result.ok) throw new Error('walk failed');
    return { ...result.value.plans[0]!, slices: result.value.plans[0]!.slices.map((s) => ({ ...s, branches: s.branches.map((b) => ({ ...b, ...branchOver })) })) };
  };
  const one = plan('other/p.md', ['feature/a']);
  const noteOf = (over: Record<string, unknown>) => planReport(assembled([one], {}, over) as never, header, false).split('\n')[2];

  it('names each branch state in its note', () => {
    expect(noteOf({ state: 'waiting', waitsOn: ['A', 'B'] })).toBe('      feature/a — waiting on A, B');
    expect(noteOf({ state: 'blocked', waitsOn: ['A'] })).toBe('      feature/a — blocked — no PR found for A');
    expect(noteOf({ state: 'deferred', deferredReason: '' })).toBe('      feature/a — deferred');
    expect(noteOf({ state: 'deferred', deferredReason: 'later' })).toBe('      feature/a — deferred — later');
    expect(noteOf({ state: 'claimed', claimed: '' })).toBe('      feature/a — claimed');
    expect(noteOf({ state: 'claimed', claimed: 'x' })).toBe('      feature/a — claimed (x)');
    expect(noteOf({ state: 'merged' })).toBe('      feature/a — merged');
    expect(noteOf({ state: 'wip' })).toBe('      feature/a — in progress');
    expect(noteOf({ state: 'unknown' })).toBe('      feature/a — unknown — PR could not be read (ok host)');
    expect(noteOf({ state: 'open' })).toBe('      feature/a — open');
  });

  it('keeps a plan path outside the plan directory, names an unnamed slice, and prints the degraded note under --loose', () => {
    const p = assembled([one], {}) as never as { slices: Array<Record<string, unknown>> };
    const shaped = { ...p, slices: [{ ...p.slices[0], name: '', verdict: 'eligible', free: 0, taken: 1, looseDegraded: ['feature/a(no-host)'] }, { ...p.slices[0], branches: [] }] };
    const text = planReport(shaped as never, header, true);
    expect(text.split('\n').slice(0, 3)).toEqual([
      '== other/p.md ==',
      '  (unnamed) — eligible — someone-is-on-it',
      '      (--loose degraded to strict: checks unavailable for feature/a(no-host))',
    ]);
    expect(planReport(shaped as never, header, false)).not.toContain('degraded');
    const free = { ...shaped, slices: [{ ...shaped.slices[0], name: 'S', free: 1 }] };
    expect(planReport(free as never, header, false).split('\n')[1]).toBe('  S — eligible');
  });

  it('names the checkout without a count when it is not behind, and the --loose words', () => {
    const moved = { ...header, localHead: 'def' } as FleetReadingHeader;
    expect(reportBanner(moved, context)).toBe('plot-fleet pulse — abc on origin/main (not your checkout def)\n\n');
    expect(reportBanner(moved, { ...context, behind: 0 })).toBe('plot-fleet pulse — abc on origin/main (not your checkout def)\n\n');
    expect(reportBanner({ ...header, readRef: 'unknown', localHead: 'def' } as FleetReadingHeader, context)).toBe('plot-fleet pulse — unknown on origin/main\n\n');
    expect(reportBanner(header, { ...context, loose: true, looseVerifiable: true })).toBe('plot-fleet pulse — abc on origin/main (loose eligibility)\n\n');
    expect(reportBanner(header, { ...context, loose: true })).toContain('--loose cannot verify PR readiness');
  });

  it('notes a failed fetch with its message, and a worktree plan source', () => {
    const notes = reportNotes({ ...header, fetchFailed: true, fetchError: 'boom' } as FleetReadingHeader, { ...context, planSource: 'worktree' });
    expect(notes).toContain('git fetch failed');
    expect(notes).toContain('        boom\n');
    expect(notes).toContain('origin/main could not be read');
  });

  it('prints the full summary line for a walk with plans', () => {
    const assembly = assemble([one], undefined);
    expect(reportFooter(assembly, header, { ...context, subjectPredatesPlan: 2 }).split('\n')[1]).toBe(
      'summary: plans=1 waves=1 branches=1 claimed=0 claimable=0 eligible=0 blocked=0 deferred=0 waiting=0 prereq_missing=0 merge_detect=subject subject_predates_plan=2 host=ok main=main',
    );
  });
});
