import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import type { Pr } from '@plot-pm/domain/entities/pr';
import { approveHostOf } from '../../src/server/entry/approve.js';

const row = (number: number): Pr => ({
  number, repo: '', head: `idea/p${number}`, base: 'main', state: 'MERGED', mergedAt: '2026-11-17T10:00:00Z', mergeCommit: 'm',
  draft: false, mergeable: 'unknown', review: '', checks: 'unknown', failingChecks: [], url: '', author: '', headSha: 'h',
});

/**
 * The approve entry asks the in-process host one question, `prsOfCommit`, and
 * keeps every other call on the shell host. The merge itself runs through
 * `ctx.scripts.host(['pr-merge', …])` and never reaches either host.
 */
describe('approveHostOf', () => {
  const shell = hostFixture({ prs: [row(1)], commitPrs: { s: [row(1)] } });
  const composed = hostFixture({ prs: [row(2)], commitPrs: { s: [row(2)] } });
  const host = approveHostOf(shell, composed);

  it('answers prsOfCommit from the composed host', async () => {
    expect(await host.prsOfCommit('s')).toEqual({ ok: true, value: [row(2)] });
  });

  it('answers prList and commitStatus from the shell host', async () => {
    expect(await host.prList('merged', 100)).toEqual(await shell.prList('merged', 100));
    expect(host.prList).toBe(shell.prList);
    expect(host.commitStatus).toBe(shell.commitStatus);
  });
});
