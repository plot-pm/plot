import { comparableLogin, type Reader } from './ownership.js';

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
