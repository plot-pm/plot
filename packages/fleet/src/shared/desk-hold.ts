import type { DeskReads } from '@plot-pm/domain';
import type { PortResult } from '@plot-pm/domain';
import type { Trees } from '@plot-pm/domain/ports/trees';

/** One desk read, as held. */
interface Held {
  at: number;
  answer: PortResult<unknown>;
}

/** The desk reads fleetd holds between scans, keyed by operation and desk path. Held in this process only. */
export type DeskHold = Map<string, Held>;

/** A fresh hold. */
export const freshDeskHold = (): DeskHold => new Map();

/**
 * Wraps the worktree reader so a scan reads again only the desks it names.
 *
 * A desk read that `reads` does not name is answered from the hold, where the
 * hold has an answer; a missing answer is read. Every answer read is stored. The
 * quiet time is held with the time it was read and answered older by the seconds
 * since, so a desk with no commit goes quiet on schedule. An answer that failed
 * is never held.
 *
 * @param trees - the worktree reader.
 * @param hold - what earlier scans read.
 * @param reads - the desk reads this scan takes again.
 * @param now - epoch milliseconds.
 * @returns the reader the walk's desk stage reads through.
 */
export const holdDeskReads = (trees: Trees, hold: DeskHold, reads: DeskReads, now: number): Trees => {
  const again = (path: string): boolean => reads.status === 'all' || reads.status.has(path);
  const held = async <T>(op: string, path: string, reread: boolean, read: () => Promise<PortResult<T>>, age?: (value: T, seconds: number) => T): Promise<PortResult<T>> => {
    const key = `${op}\0${path}`;
    const kept = hold.get(key);
    if (!reread && kept !== undefined && kept.answer.ok) {
      const value = kept.answer.value as T;
      return age === undefined ? (kept.answer as PortResult<T>) : { ok: true, value: age(value, Math.max(0, Math.floor((now - kept.at) / 1000))) } as PortResult<T>;
    }
    const answer = await read();
    if (answer.ok) hold.set(key, { at: now, answer });
    else hold.delete(key);
    return answer;
  };
  return {
    ...trees,
    locked: (path) => held('locked', path, again(path), () => trees.locked(path)),
    dirtyPaths: (path) => held('dirty', path, again(path), () => trees.dirtyPaths(path)),
    quietSeconds: (path) => held('quiet', path, again(path), () => trees.quietSeconds(path), (value, seconds) => (value === null ? null : value + seconds)),
    unpushedCommits: (path, exclude) => (exclude.length > 0 ? trees.unpushedCommits(path, exclude) : held('unpushed', path, reads.unpushed || again(path), () => trees.unpushedCommits(path, exclude))),
  };
};
