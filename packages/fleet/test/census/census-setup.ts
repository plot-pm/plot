import { censusGate, findStrace } from './strace-run.js';

/**
 * Checks for `strace` before any census suite runs. Fails the run by name on
 * Linux when `strace` is absent from `PATH`; prints one line on macOS, where
 * every suite skips.
 */
export default (): void => {
  const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });
  if (gate.kind === 'fail') throw new Error(gate.message);
  if (gate.kind === 'skip') console.log(gate.line);
};
