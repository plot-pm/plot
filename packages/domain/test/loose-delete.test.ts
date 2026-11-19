import { describe, expect, it } from 'vitest';
import { looseDelete, type LooseDeleteReadings } from '../src/rules/loose-delete.js';

const TIP = 'a'.repeat(40);
const work = { subject: 'fix the thing', tree: 't2', parentTree: 't1' };
const claim = { subject: 'plot: claim feature/x', tree: 't1', parentTree: 't1' };

const base = (): LooseDeleteReadings => ({
  caller: 'person',
  branch: 'feature/x',
  defaultBranch: { ok: true, value: 'main' },
  plan: { kind: 'none' },
  desk: { ok: true, value: false },
  manifests: { ok: true, value: [] },
  commits: { ok: true, value: [work] },
  pr: { ok: true, value: null },
  merged: { ok: true, value: 'not-merged' },
  unpushed: null,
  remoteTip: { ok: true, value: { sha: TIP } },
  localTip: { ok: true, value: TIP },
});

describe('looseDelete', () => {
  it('names the tip to pin where every reading allows', () => {
    expect(looseDelete(base())).toEqual({ kind: 'delete', tip: TIP });
  });

  it('deletes when the local branch holds no unpushed commit', () => {
    expect(looseDelete({ ...base(), unpushed: { ok: true, value: 0 } })).toEqual({ kind: 'delete', tip: TIP });
  });

  it('keeps a commit titled like a claim that changes a file deletable', () => {
    const titled = { subject: 'plot: claim handling refactor', tree: 't2', parentTree: 't1' };
    expect(looseDelete({ ...base(), commits: { ok: true, value: [titled] } })).toEqual({ kind: 'delete', tip: TIP });
  });

  it('refuses on each reading that disagrees with the baseline, and only that one', () => {
    const cases: Array<[Partial<LooseDeleteReadings>, string]> = [
      [{ caller: 'unattended' }, 'unattended'],
      [{ defaultBranch: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ branch: 'main' }, 'protected'],
      [{ branch: 'sprint/ship-2-32-0' }, 'protected'],
      [{ branch: 'changeset-release/main' }, 'protected'],
      [{ plan: { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: false, base: '' } as never }, 'named'],
      [{ plan: { kind: 'unreadable' } }, 'unaskable'],
      [{ desk: { ok: true, value: true } }, 'held'],
      [{ desk: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ manifests: { ok: true, value: ['agent-7'] } }, 'held'],
      [{ manifests: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ commits: { ok: true, value: [claim, work] } }, 'claimed'],
      [{ commits: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ pr: { ok: true, value: { number: 1, state: 'OPEN' } as never } }, 'open-pr'],
      [{ pr: { ok: false, why: 'unaskable' } }, 'unaskable'],
      [{ merged: { ok: true, value: 'merged' } }, 'merged'],
      [{ merged: { ok: true, value: 'unknown' } }, 'unaskable'],
      [{ unpushed: { ok: true, value: 2 } }, 'unpushed'],
      [{ unpushed: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ remoteTip: { ok: true, value: 'unknown' } }, 'no-remote-branch'],
      [{ localTip: { ok: true, value: 'b'.repeat(40) } }, 'tip-moved'],
      [{ localTip: { ok: false, why: 'failed' } as never }, 'tip-moved'],
    ];
    for (const [over, reason] of cases) {
      expect(looseDelete({ ...base(), ...over }), JSON.stringify(over)).toMatchObject({ kind: 'refuse', reason });
    }
  });

  it('deletes a claimed branch whose work ended in a PR the host closed unmerged', () => {
    const closed = { ok: true, value: { number: 3054, state: 'CLOSED' } } as never;
    expect(looseDelete({ ...base(), commits: { ok: true, value: [claim, work] }, pr: closed })).toEqual({ kind: 'delete', tip: TIP });
  });

  it('still refuses a claimed branch whose closed PR left only the claim', () => {
    const closed = { ok: true, value: { number: 3054, state: 'CLOSED' } } as never;
    expect(looseDelete({ ...base(), commits: { ok: true, value: [claim] }, pr: closed })).toMatchObject({ reason: 'claimed' });
  });

  it('still refuses a claimed branch with work and no closed PR', () => {
    const withWork = { commits: { ok: true, value: [claim, work] } } as const;
    expect(looseDelete({ ...base(), ...withWork })).toMatchObject({ reason: 'claimed' });
    const open = { ok: true, value: { number: 3054, state: 'OPEN' } } as never;
    expect(looseDelete({ ...base(), ...withWork, pr: open })).toMatchObject({ reason: 'claimed' });
  });

  it('refuses a claimed branch with work as unaskable where the host cannot rule out a merge of its closed PR', () => {
    const closed = { ok: true, value: { number: 1425, state: 'CLOSED' } } as never;
    const withWork = { commits: { ok: true, value: [work, work, claim] } } as const;
    for (const merged of [{ ok: true, value: 'unknown' }, { ok: false, why: 'unaskable' }] as const) {
      expect(looseDelete({ ...base(), ...withWork, pr: closed, merged }), JSON.stringify(merged)).toEqual({
        kind: 'refuse',
        reason: 'unaskable',
        detail: 'the host cannot say whether feature/x merged, so its closed PR #1425 cannot be read as closed work',
      });
    }
  });

  it('refuses a claimed branch with work as unaskable where the host cannot say whether a PR exists', () => {
    const withWork = { commits: { ok: true, value: [claim, work] } } as const;
    expect(looseDelete({ ...base(), ...withWork, pr: { ok: false, why: 'unaskable' } })).toMatchObject({ reason: 'unaskable' });
  });

  it('still refuses a claim-only branch as claimed while the host cannot be asked', () => {
    const only = { commits: { ok: true, value: [claim] } } as const;
    expect(looseDelete({ ...base(), ...only, pr: { ok: false, why: 'unaskable' } })).toMatchObject({ reason: 'claimed' });
    expect(looseDelete({ ...base(), ...only, merged: { ok: true, value: 'unknown' } })).toMatchObject({ reason: 'claimed' });
  });

  it('refuses a named branch before it asks whether a desk holds it', () => {
    const named = { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: false, base: '' } as never;
    expect(looseDelete({ ...base(), plan: named, desk: { ok: true, value: true } })).toMatchObject({ reason: 'named' });
  });
});
