import { describe, it, expect } from 'vitest';
import { classify, prState, prStates, withBranchTips, type PrRecord } from '../../src/server/fleet.js';
import { stuckState } from '../../src/server/stuck.js';

const OLD = 'dc98f4a02';
const NEW = '75da18f94';

const pr = (over: Partial<PrRecord> = {}): PrRecord => ({
  number: 2996, head: 'bug/x', state: 'OPEN', draft: false, checks: 'failing', review: '',
  mergeable: 'mergeable', url: 'https://example.test/pr/2996', checksSha: OLD, ...over,
});

const refsWithTips = (tips: Array<{ branch: string; sha: string }>, ok = true) =>
  ({ branchTips: async () => (ok ? { ok: true, value: tips } : { ok: false }) }) as never;

describe('a Delivery row whose index holds the old head and whose local ref moved', () => {
  it('is not waiting on you and says the new head is unread', async () => {
    const [prs] = await withBranchTips(
      { repoRoot: '/r', refs: refsWithTips([{ branch: 'bug/x', sha: NEW }]) } as never,
      new Map([['bug/x', pr()]]),
      null,
    );
    const attached = prs!.get('bug/x')!;
    expect(attached.tip).toBe(NEW);
    const r = classify('wip', 'eligible', 3, 60, attached);
    expect(r.group).toBe('waiting-on-machine');
    expect(r.note).toMatch(/new head, checks not yet read/);
    expect(prState(attached)).not.toBe('failing');
  });

  it('does not make stuckState report ci-failing', () => {
    const stuck = stuckState({ prState: prState({ ...pr(), tip: NEW } as PrRecord) } as never);
    expect(stuck?.state).not.toBe('ci-failing');
  });

  it('keeps checks failing when the tip equals checksSha', async () => {
    const [prs] = await withBranchTips(
      { repoRoot: '/r', refs: refsWithTips([{ branch: 'bug/x', sha: OLD }]) } as never,
      new Map([['bug/x', pr()]]),
      null,
    );
    expect(classify('wip', 'eligible', 3, 60, prs!.get('bug/x')!).group).toBe('waiting-on-you');
    expect(prStates(prs!.get('bug/x')!)).toEqual(['failing']);
  });

  it('attaches no tip, and changes nothing, when the tip read fails', async () => {
    const input = new Map([['bug/x', pr()]]);
    const [prs] = await withBranchTips({ repoRoot: '/r', refs: refsWithTips([], false) } as never, input, null);
    expect(prs).toBe(input);
  });
});
