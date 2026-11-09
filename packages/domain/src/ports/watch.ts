/** One change a watch observed in an armed directory. */
export interface WatchEvent {
  /** The directory that was armed, exactly as passed to `arm`. */
  readonly dir: string;
  /** The entry the change names, relative to `dir`; empty when the platform gives none. */
  readonly name: string;
  /** `rename` for an entry created, removed or renamed over; `change` for a content change. */
  readonly kind: 'rename' | 'change';
}

/** Receives each event of one armed directory. */
export type WatchListener = (event: WatchEvent) => void;

/** Options for arming one directory. */
export interface WatchOptions {
  /** Watch the whole subtree. Callers never pass `true` for `.git/`. */
  readonly recursive: boolean;
}

/** One armed directory. */
export interface WatchHandle {
  /** `true` when the directory could not be armed, or a re-arm after a rename failed; no further events arrive. */
  readonly degraded: boolean;
  /** Stops delivery and releases the OS watch. Calling it again does nothing. */
  close(): void;
}

/**
 * Tells a caller that something changed in a directory.
 *
 * Directories only: a file watch follows the old inode, and git replaces a file
 * by renaming a lock file over it. An implementation re-arms a directory after a
 * `rename` event. `arm` never throws; a directory that cannot be armed returns a
 * handle with `degraded: true`, and the caller falls back to polling.
 */
export interface Watch {
  /**
   * Arms `dir` and delivers its events to `listener`.
   *
   * @param dir directory to watch.
   * @param options watch depth.
   * @param listener called once per event.
   * @returns the handle; `degraded` is `true` when arming failed.
   */
  arm(dir: string, options: WatchOptions, listener: WatchListener): WatchHandle;
}
