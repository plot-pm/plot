/**
 * Asks `kill(target, 0)` and maps the answer: no error is a live process,
 * `ESRCH` is none, and `EPERM` is a process this user may not signal, and so a
 * live one. Starts no process.
 *
 * @param target - a pid, or a negative process-group id.
 * @returns true for alive, false for gone, or null for any other error.
 */
export const signalZero = (target: number): boolean | null => {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
};
