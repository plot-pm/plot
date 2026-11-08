import { execFileSync, spawn } from 'node:child_process';
import { closeSync, constants, openSync, writeSync } from 'node:fs';

/** A stand-in for a desk's worker: alive, idle, and starting nothing. */
export type StubWorker = {
  pid: number;
  fifo: string;
  /** Resolves with the exit code once the worker has exited. */
  exited: Promise<number | null>;
  /** Writes one line into the FIFO, which ends the worker, and waits for its pid. */
  stop: () => Promise<number | null>;
};

/** The worker's whole program: one builtin `read` on the FIFO. It forks and execs nothing. */
export const STUB_WORKER_SCRIPT = 'read -r _ < "$1"';

/** The command and argv that run a stub worker on `fifo`. */
export const stubWorkerCommand = (fifo: string): [string, string[]] => ['/bin/sh', ['-c', STUB_WORKER_SCRIPT, 'stub-worker', fifo]];

/**
 * Writes one line into `fifo` if a reader holds it. Non-blocking: returns
 * false at once when no process reads it yet, or any more.
 */
export const releaseFifo = (fifo: string): boolean => {
  try {
    const fd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    writeSync(fd, '\n');
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
};

/**
 * Starts a stub worker that blocks in a builtin `read` on a FIFO the test
 * holds. The worker's own image is `/bin/sh`; while it waits it starts no
 * process, so a count over a desk holds only Plot's own processes.
 *
 * @param fifo - where to create the FIFO; it must not exist yet.
 * @returns the running worker.
 */
export const startStubWorker = async (fifo: string): Promise<StubWorker> => {
  execFileSync('mkfifo', [fifo]);
  const [command, args] = stubWorkerCommand(fifo);
  const child = spawn(command, args, { stdio: 'ignore' });
  if (child.pid === undefined) throw new Error('process census: the stub worker did not start');
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  const stop = async (): Promise<number | null> => {
    // NON-BLOCKING: an open with no reader fails with ENXIO instead of waiting
    // forever. A worker that has not yet reached its `read` is asked again for
    // up to 2 s; one that never reads is ended with SIGTERM.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      if (releaseFifo(fifo)) return exited;
      await new Promise((r) => setTimeout(r, 20));
    }
    child.kill('SIGTERM');
    return exited;
  };
  return { pid: child.pid, fifo, exited, stop };
};
