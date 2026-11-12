import { describe, expect, it } from 'vitest';
import { looseDelete, type LooseDeleteReadings } from '../src/rules/loose-delete.js';

const TIP = 'a'.repeat(40);
const base = (): LooseDeleteReadings => ({
  caller: 'person',
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

  it('deletes when the checkout holds no unpushed commit', () => {
    expect(looseDelete({ ...base(), unpushed: { ok: true, value: [] } })).toEqual({ kind: 'delete', tip: TIP });
  });

  it('refuses on each reading that disagrees with the baseline, and only that one', () => {
    const cases: Array<[Partial<LooseDeleteReadings>, string]> = [
      [{ caller: 'unattended' }, 'unattended'],
      [{ pr: { ok: true, value: { number: 1, state: 'OPEN' } as never } }, 'open-pr'],
      [{ pr: { ok: false, why: 'unaskable' } }, 'unaskable'],
      [{ merged: { ok: true, value: 'merged' } }, 'merged'],
      [{ merged: { ok: true, value: 'unknown' } }, 'unaskable'],
      [{ unpushed: { ok: true, value: ['abc'] } }, 'unpushed'],
      [{ unpushed: { ok: false, why: 'failed' } }, 'unaskable'],
      [{ remoteTip: { ok: true, value: 'unknown' } }, 'no-remote-branch'],
      [{ localTip: { ok: true, value: 'b'.repeat(40) } }, 'tip-moved'],
      [{ localTip: { ok: false, why: 'failed' } as never }, 'tip-moved'],
    ];
    for (const [over, reason] of cases) {
      expect(looseDelete({ ...base(), ...over })).toMatchObject({ kind: 'refuse', reason });
    }
  });
});
