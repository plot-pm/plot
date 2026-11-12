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

  it('refuses a named branch before it asks whether a desk holds it', () => {
    const named = { kind: 'named', file: 'docs/plans/p.md', phase: 'approved', deferred: false, base: '' } as never;
    expect(looseDelete({ ...base(), plan: named, desk: { ok: true, value: true } })).toMatchObject({ reason: 'named' });
  });
});
