import { comparableLogin, ownership, type OwnedRow, type Reader } from './ownership.js';

/**
 * How «Mine» filters the board.
 *
 * - `all` — every row shows. «Mine» is off, or the reader has no login the
 *   board can compare against a row's owner.
 * - `mine-and-unknown` — a row hides only where its owner is somebody else's.
 *   Today's view.
 * - `mine` — only a row the reader owns stays.
 */
export type MineMode = 'all' | 'mine-and-unknown' | 'mine';

/**
 * The two stored strings the effective «Mine» mode reads.
 *
 * Each is read exactly as the `localStorage` key holds it: `undefined` where
 * the key is absent, so a reader who never touches the strict control sees
 * `mineOnly` alone decide the mode, as it always has.
 */
export interface MineModeStorage {
  /** The existing key, `plot-board:agents:mine-only`. `'1'` is on; anything else, including absence, is off. */
  readonly mineOnly: string | undefined;
  /** The strict-mode key. `'1'` is on; anything else, including absence, is off. */
  readonly strict: string | undefined;
}

/**
 * The effective «Mine» mode, from the reader and the two stored strings.
 *
 * Gated on {@link comparableLogin}, not `readerIsKnown`: a reader with only a
 * git email has no login any ownership arm can match, so the mode is `all`
 * whatever either key holds — a disabled chip must never sit beside a filter
 * that empties the board.
 *
 * @param reader - who is reading.
 * @param storage - the two stored strings, read verbatim.
 * @returns `all`, `mine-and-unknown`, or `mine`.
 */
export const mineMode = (reader: Reader, storage: MineModeStorage): MineMode => {
  if (comparableLogin(reader) === '' || storage.mineOnly !== '1') return 'all';
  return storage.strict === '1' ? 'mine' : 'mine-and-unknown';
};

/**
 * A row as the «Mine» counts read it: its ownership reading and, where it has
 * one, the branch it sits on.
 *
 * Entries that name the same non-empty branch count as one, so a branch row
 * and the registry agent on that branch never count twice. An entry with no
 * branch counts on its own.
 */
export type BranchOwnedRow = OwnedRow & { readonly branch?: string | null };

/** How many rows «Mine» hides, by the reason it hides them. */
export interface MineCounts {
  /** Rows somebody else owns. Every mode except `all` hides them. */
  readonly theirs: number;
  /** Rows with no known owner. Only the `mine` mode hides them. */
  readonly unknown: number;
}

/**
 * Counts rows by ownership, one per branch.
 *
 * A branch counts as `theirs` where any of its entries answers `theirs`, and
 * as `unknown` where none does and any answers `unknown`.
 *
 * @param rows - the rows before the «Mine» filter, each with its branch where it has one.
 * @param reader - who is reading.
 * @returns the `theirs` and `unknown` counts.
 */
export const mineCounts = (rows: readonly BranchOwnedRow[], reader: Reader): MineCounts => {
  const byKey = new Map<string, Set<string>>();
  rows.forEach((row, index) => {
    const key = row.branch ? `branch:${row.branch}` : `entry:${index}`;
    const answers = byKey.get(key) ?? new Set<string>();
    answers.add(ownership(row, reader));
    byKey.set(key, answers);
  });
  const answers = [...byKey.values()];
  return {
    theirs: answers.filter((a) => a.has('theirs')).length,
    unknown: answers.filter((a) => !a.has('theirs') && a.has('unknown')).length,
  };
};

/**
 * How many rows a mode hides.
 *
 * @param counts - the rows by ownership, from {@link mineCounts}.
 * @param mode - the effective «Mine» mode.
 * @returns `theirs` plus `unknown` in `mine`, otherwise `theirs`.
 */
export const mineHiddenCount = (counts: MineCounts, mode: MineMode): number =>
  mode === 'mine' ? counts.theirs + counts.unknown : counts.theirs;

/** The control beside «Mine» that hides or shows the rows with no known owner. */
export interface MineStrictControl {
  /** What the control reads: `hide N unknown` in `mine-and-unknown`, `show N unknown` in `mine`. */
  readonly label: string;
  /** Whether the stricter mode is on, i.e. the mode is `mine`. */
  readonly pressed: boolean;
  /** How many rows have no known owner. */
  readonly unknownCount: number;
}

/**
 * The hide/show-unknown control, or `null` where it does not show.
 *
 * It shows only while the mode is `mine-and-unknown` or `mine` and the
 * unknown count is above 0.
 *
 * @param mode - the effective «Mine» mode.
 * @param unknownCount - how many rows have no known owner.
 * @returns the control's label and state, or `null`.
 */
export const mineStrictControl = (mode: MineMode, unknownCount: number): MineStrictControl | null => {
  if (mode === 'all' || unknownCount <= 0) return null;
  const pressed = mode === 'mine';
  return { label: `${pressed ? 'show' : 'hide'} ${unknownCount} unknown`, pressed, unknownCount };
};
