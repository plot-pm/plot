import type { TokenReading } from '../rules/worker-liveness.js';

/** A token the wrapper made and still holds open. */
export interface MadeToken {
  /** The token's path. */
  readonly path: string;
  /** The descriptor this process holds it on, read-write. */
  readonly fd: number;
}

/**
 * A desk's liveness token: a FIFO that every process holding its descriptor
 * keeps `held`, and that reads `released` once none is left.
 */
export interface LivenessToken {
  /**
   * Reads the token in `desk` once, without blocking and without starting a process.
   *
   * @param desk - the desk's absolute path.
   * @returns `held`, `released` or `none`, and the FIFO's modification time.
   */
  read(desk: string): TokenReading;
  /**
   * Makes a new token in `desk` under a temporary name, opens it read-write,
   * and renames it over the token path. A failure leaves no file at the token
   * path and none at the temporary name.
   *
   * @param desk - the desk's absolute path.
   * @returns the token and the descriptor this process holds; the reason on a failure.
   */
  make(desk: string): { ok: true; token: MadeToken } | { ok: false; reason: string };
  /** Closes this process's descriptor of a made token. */
  close(token: MadeToken): void;
}
