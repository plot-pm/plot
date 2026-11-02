import { sliceHold } from '@plot-pm/domain';
import type { AgentRow, SliceVerdict, WaitingOn } from '../../../contract/schema.js';

/** What a slice row says about itself, before its branch or its count speak. */
export interface SliceRowReading {
  /** Whether {@link sliceHold} holds the slice: every unsettled branch waits on an open `waits:`. */
  held: boolean;
  /** The slot-5 word, or `null` where the verdict itself is the word. */
  word: string | null;
  /** The note: the held branches' own notes, or the verdict's sentence. */
  note: string;
  /** The tone: `time` for a held `waiting` slice, `you` where only a plan edit clears it. */
  tone: WaitingOn | null;
  /** Whether the row offers a dispatch. */
  dispatch: boolean;
}

/**
 * Reads a slice row's word, note, tone and dispatch gate from its verdict and
 * branch rows.
 *
 * A held slice reads `waiting` with the held branches' notes joined by `; `.
 * Any other slice speaks its verdict.
 *
 * @param verdict - the slice's verdict, as the scan reports it.
 * @param rows - the slice's branch rows; `state` and `startability` feed {@link sliceHold}.
 * @returns the reading.
 */
export const sliceRowReading = (
  verdict: SliceVerdict | null,
  rows: readonly Pick<AgentRow, 'branch' | 'state' | 'startability' | 'note'>[],
): SliceRowReading => {
  const hold = sliceHold(
    verdict ?? '',
    rows.map((r) => ({ branch: r.branch, state: r.state, startability: r.startability })),
  );
  if (hold) {
    const note = rows
      .filter((r) => hold.held.includes(r.branch))
      .map((r) => r.note)
      .filter((n) => n !== '')
      .join('; ');
    return { held: true, word: 'waiting', note, tone: hold.blocked ? 'you' : 'time', dispatch: false };
  }
  switch (verdict) {
    case 'eligible':
      return { held: false, word: null, note: 'approved — nobody has taken it', tone: 'you', dispatch: true };
    case 'blocked':
      return { held: false, word: null, note: 'an earlier slice has to land first', tone: 'time', dispatch: false };
    case 'unapproved':
      return { held: false, word: null, note: 'the plan needs approving first', tone: 'you', dispatch: false };
    default:
      return { held: false, word: null, note: '', tone: null, dispatch: false };
  }
};
