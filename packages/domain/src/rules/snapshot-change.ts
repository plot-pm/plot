import type { WatchEvent } from '../ports/watch.js';
import type { SnapshotChange, StaleReading } from './snapshot-stale.js';

/** One desk the watch set covers: its checkout and the git admin directory that holds its `HEAD` and `index`. */
export interface WatchDesk {
  /** The desk's absolute path. */
  path: string;
  /** `<common git dir>/worktrees/<name>`, absolute. */
  admin: string;
}

/** Every path fleetd watches, absolute. */
export interface WatchLayout {
  /** The main checkout's root, where `CLAUDE.md` lives. */
  repoRoot: string;
  /** The common git directory. */
  commonDir: string;
  /** The `Agent registry` directory. */
  registryDir: string;
  /** The linked desks, not the main checkout. */
  desks: readonly WatchDesk[];
}

/** One directory to arm. */
export interface WatchTarget {
  dir: string;
  recursive: boolean;
}

const strip = (path: string): string => (path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path);

/**
 * Lists the directories to arm, one per source of the watch table.
 *
 * The common git directory's `refs/` is the only recursive watch; `.git/` is
 * never watched recursively.
 *
 * @param layout - the paths fleetd watches.
 * @returns the targets in a fixed order: refs, the common git dir, each desk's
 *   admin directory and root, the registry, the main checkout's root.
 */
export const watchTargets = (layout: WatchLayout): readonly WatchTarget[] => {
  const common = strip(layout.commonDir);
  return [
    { dir: `${common}/refs`, recursive: true },
    { dir: common, recursive: false },
    ...layout.desks.flatMap((desk) => [
      { dir: strip(desk.admin), recursive: false },
      { dir: strip(desk.path), recursive: false },
    ]),
    { dir: strip(layout.registryDir), recursive: false },
    { dir: strip(layout.repoRoot), recursive: false },
  ];
};

/**
 * Maps one watch event to the change it raises.
 *
 * The directory identifies the source and the name filters inside it. An event
 * that names no entry in a directory that filters by name raises that
 * directory's change, because a change that is not named cannot be ruled out.
 * Plans, sprints and stories raise no change of their own: a refs change names
 * `plans` too.
 *
 * @param event - what a watch delivered.
 * @param layout - the paths that were armed.
 * @returns the change, or `null` where the event names nothing fleetd reads.
 */
export const changeOf = (event: WatchEvent, layout: WatchLayout): SnapshotChange | null => {
  const dir = strip(event.dir);
  const name = event.name;
  const common = strip(layout.commonDir);
  if (dir === `${common}/refs`) return { kind: 'refs' };
  if (dir === common) return name === '' || name === 'packed-refs' ? { kind: 'refs' } : null;
  for (const desk of layout.desks) {
    if (dir === strip(desk.admin)) return name === '' || name === 'HEAD' || name === 'index' ? { kind: 'desk-git', desk: desk.path } : null;
    if (dir === strip(desk.path)) {
      if (name === '.plot-worker.log') return { kind: 'worker-log', desk: desk.path };
      return name === '' || name === 'PLOT-BLOCKED' || name === 'PLOT-CORRECTION.md' || name.startsWith('.plot-worker.')
        ? { kind: 'desk-files', desk: desk.path }
        : null;
    }
  }
  if (dir === strip(layout.registryDir)) return { kind: 'registry' };
  if (dir === strip(layout.repoRoot)) return name === '' || name === 'CLAUDE.md' ? { kind: 'config' } : null;
  return null;
};

/**
 * Tells a change a read caused from one that changed something.
 *
 * fleetd's own `git status` and `git fetch` write files it watches. A reading
 * taken after the event and equal to the one held means the event changed no
 * content.
 *
 * @param held - the reading taken at the last accepted change; `null` before any.
 * @param fresh - the reading taken now; `null` where it could not be read.
 * @returns `false` only when both are readings and equal.
 */
export const contentChanged = (held: string | null, fresh: string | null): boolean => held === null || fresh === null || held !== fresh;

/**
 * Adds the readings a change made stale to the pending set.
 *
 * @param pending - the readings already pending.
 * @param incoming - the readings a change names.
 * @returns the union, each key once, and each key and desk pair once; the held
 *   readings keep their order.
 */
export const addPending = (pending: readonly StaleReading[], incoming: readonly StaleReading[]): readonly StaleReading[] => {
  const seen = new Set(pending.map((r) => `${r.key}\0${r.desk ?? ''}`));
  const added = incoming.filter((r) => {
    const id = `${r.key}\0${r.desk ?? ''}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return added.length === 0 ? pending : [...pending, ...added];
};
