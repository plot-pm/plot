import { describe, expect, it } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import type { Pr } from '@plot-pm/domain';
import { run } from '../../src/server/entry/review-bypass.js';

const pr = (number: number, mergedAt: string | null): Pr => ({
  number, repo: '', head: `feature/pr-${number}`, state: 'MERGED', mergedAt, mergeCommit: '',
  draft: false, mergeable: 'unknown', review: 'none', checks: 'green', failingChecks: [], url: '',
  author: 'jwloka',
});

const SINCE = '2026-10-14T00:00:00Z';
const AFTER = '2026-10-15T00:00:00Z';

const output = async (
  options: Parameters<typeof hostFixture>[0],
  since = SINCE,
): Promise<{ code: number; lines: string[] }> => {
  const lines: string[] = [];
  const code = await run(hostFixture(options), since, 100, (l) => lines.push(l));
  return { code, lines };
};

describe('plot-review-bypass', () => {
  it('reports a green-CI merge with no plot/review and no comment (the #1687 shape)', async () => {
    const { lines } = await output({
      prs: [pr(1687, AFTER)],
      reviews: { 1687: { sha: 'a', state: 'absent', bypass: false } },
    });
    expect(lines.filter((l) => l.startsWith('  PR #'))).toEqual([
      '  PR #1687 merged with no passing plot/review and no review-bypass: comment',
    ]);
    expect(lines.join('\n')).not.toContain('(none');
  });

  it('does not report a bypass comment or a passing review', async () => {
    const { lines } = await output({
      prs: [pr(1, AFTER), pr(2, AFTER)],
      reviews: {
        1: { sha: 'a', state: 'failure', bypass: true },
        2: { sha: 'b', state: 'success', bypass: false },
      },
    });
    expect(lines).toEqual(['  (none — every examined merge carries a passing plot/review or a bypass note)']);
  });

  it('names an unread PR and never prints none while a read failed', async () => {
    const { lines } = await output({
      prs: [pr(3, AFTER), pr(4, AFTER)],
      reviews: { 4: { sha: 'a', state: 'success', bypass: false } },
    });
    expect(lines).toEqual(['  unread PR #3 — the host read failed; its review is unknown']);
  });

  it('asks the host nothing and says so with no cutoff', async () => {
    const { code, lines } = await output({ prs: [pr(5, AFTER)] }, '');
    expect(code).toBe(0);
    expect(lines).toEqual([
      '  (not evaluated — no `Review required since` key is set, so no merge is held to the rule)',
    ]);
  });

  it('notes a merged list that reached its limit', async () => {
    const lines: string[] = [];
    await run(
      hostFixture({
        prs: [pr(6, AFTER)],
        reviews: { 6: { sha: 'a', state: 'success', bypass: false } },
      }),
      SINCE, 1, (l) => lines.push(l),
    );
    expect(lines.at(-1)).toContain('hit its limit of 1');
  });

  it('skips a merged entry that has no mergedAt', async () => {
    const { lines } = await output({ prs: [pr(7, null)] });
    expect(lines).toEqual(['  (none — every examined merge carries a passing plot/review or a bypass note)']);
  });
});
