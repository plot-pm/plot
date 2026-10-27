/**
 * Ends a bundle entry after stdout and stderr have drained, so a pipe reader
 * receives every byte the entry wrote before the process exits.
 *
 * Writes an empty chunk to each stream and waits for its callback — Node
 * fires a write's callback only after the data ahead of it in that stream's
 * queue has been accepted by the OS, so an empty write's callback is a drain
 * signal for everything queued before it. `process.exit(code)` only then
 * runs. An `EPIPE` on either stream (a reader that closed early) calls
 * `process.exit(code)` at once, so a closed reader does not change the code.
 *
 * Returns a promise that never settles: `await endEntry(code)` stops the
 * async flow it is called from, and no statement after it runs.
 *
 * @param code - the process exit code.
 * @returns a promise that never resolves or rejects.
 */
export const endEntry = (code: number): Promise<never> =>
  new Promise<never>((_resolve, _reject) => {
    const exit = (): void => {
      process.exit(code);
    };
    let stdoutDone = false;
    let stderrDone = false;
    const onStdoutDone = (): void => {
      if (stdoutDone) return;
      stdoutDone = true;
      if (stderrDone) exit();
    };
    const onStderrDone = (): void => {
      if (stderrDone) return;
      stderrDone = true;
      if (stdoutDone) exit();
    };
    process.stdout.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') exit();
    });
    process.stderr.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') exit();
    });
    process.stdout.write('', onStdoutDone);
    process.stderr.write('', onStderrDone);
  });
