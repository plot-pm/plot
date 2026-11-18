import { stat } from 'node:fs/promises';

/** A reading that is re-taken only when its source's stat key changes. */
export interface StatCache<T> {
  /**
   * The reading. Takes one stat; re-reads only where the key differs from the
   * key of the reading held, or where none is held.
   */
  get(): Promise<T>;
}

/**
 * A reading cached by a stat key, never by a timer.
 *
 * A `null` key means the source could not be stat-ed: the reading is then
 * taken on every call, because nothing says it is unchanged. A read that
 * answers `ok: false` is returned but not held, so the next call asks again.
 *
 * @param statKey - one stat of the source: a string that changes when the source does, or `null`.
 * @param read - takes the reading; `ok: false` marks a failed read.
 * @returns the cache.
 */
export const statCache = <T>(
  statKey: () => Promise<string | null>,
  read: () => Promise<{ ok: boolean; value: T }>,
): StatCache<T> => {
  let held: { key: string; value: T } | null = null;
  return {
    get: async () => {
      const key = await statKey();
      if (key !== null && held !== null && held.key === key) return held.value;
      const answer = await read();
      held = key !== null && answer.ok ? { key, value: answer.value } : null;
      return answer.value;
    },
  };
};

/**
 * The stat key of a file: its size and modification time, or `absent` where it does not exist.
 *
 * @param path - the file.
 * @returns the key, or `null` where the stat failed for another reason.
 */
export const fileStatKey = async (path: string): Promise<string | null> => {
  try {
    const s = await stat(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? 'absent' : null;
  }
};
