import type { PortResult } from '../port-result.js';

/**
 * Whether a scratch-desk write probe proves the configured `Worker command`
 * can write, and so may a claim be pushed for it.
 *
 * Mirrors `PermissionDenialReading` in {@link ./sample.js}: `yes` and `no` are
 * both observed outcomes, and `unanswerable` is a THIRD thing — the probe
 * itself did not run to a conclusion, which is not evidence either way.
 */
export type WriteProbeReading = 'yes' | 'no' | 'unanswerable';

/**
 * Whether a probe reading permits a claim to be pushed.
 *
 * **ABSENT IS NOT FALSE.** A probe that could not run — no harness on `PATH`,
 * the scratch desk could not be cut, the command timed out or exited non-zero
 * — did not observe a refused write, so `unanswerable` proceeds exactly as
 * `yes` does. Only an OBSERVED absence of the touched file after the command
 * exited 0 is `no` (see {@link probeRunReading}), and only `no` refuses.
 *
 * @param reading - what the probe observed.
 * @returns `proceed` to hand over, `refuse` to stop before any claim is pushed.
 */
export const writeProbeAnswer = (reading: WriteProbeReading): 'proceed' | 'refuse' =>
  reading === 'no' ? 'refuse' : 'proceed';

/**
 * The message a refused probe reports, naming the same cause and the same
 * advice as `needsPersonMarker`'s `permission-denied` case in
 * {@link ./ending-action.js} — one fault, one wording, whether it is read after
 * the fact from an ended agent or caught before a claim exists.
 *
 * @param detail - what the probe observed; empty when nothing more was recorded.
 * @returns the refusal text.
 */
export const writeProbeRefusal = (detail: string): string =>
  `The worker command was refused every write it tried (${detail || 'no detail was recorded'}). ` +
  `A dispatched agent would meet the same refusals. Decide: fix the worker command's permissions, then try again.`;

/**
 * Whether a configured `Worker command` starts anything the probe can test.
 *
 * An empty value and `none` start no agent (`plot-config.sh` reads an absent
 * key as empty, and `none` means "never run as a command"), so neither is
 * probed and neither refuses a start.
 *
 * @param command - the configured `Worker command` value.
 * @returns `true` when the probe runs, `false` when the start proceeds unprobed.
 */
export const writeProbeNeeded = (command: string): boolean => {
  const trimmed = command.trim();
  return trimmed !== '' && trimmed !== 'none';
};

/** The prefix of the `unaskable` reason a probe returns for a prompt file whose print cannot be trusted. */
export const STALE_PRINT_REASON = 'stale-print';

/** Launch flags the probe must pass when the prompt file's launch line passes them. */
const LAUNCH_FLAGS_THE_PROBE_NEEDS = ['--permission-mode'] as const;

/** The prompt file's lines that are not shell comments. */
const codeLines = (promptText: string): string[] => promptText.split('\n').filter((line) => !/^\s*#/.test(line));

/**
 * Whether a prompt file can print its invocation under `PLOT_PRINT_INVOCATION=1`.
 *
 * A file with no such block runs its real prompt when sourced, so the probe
 * must not source it.
 *
 * @param promptText - the prompt file's text.
 * @returns `true` when a non-comment line names `PLOT_PRINT_INVOCATION`.
 */
export const promptPrintsInvocation = (promptText: string): boolean =>
  codeLines(promptText).some((line) => line.includes('PLOT_PRINT_INVOCATION'));

/**
 * The first launch flag the prompt file passes but its print omits.
 *
 * A print written before the template printed `--permission-mode` leaves it out
 * while the launch line still passes it. A probe run with that print tests a
 * command the fleet never runs, and a headless run without the flag cannot
 * approve a Write.
 *
 * @param promptText - the prompt file's text.
 * @param printedFlags - the flags the file printed, without the harness name.
 * @returns the omitted flag, or `undefined` when the print carries every flag
 *   in the list that the file's code names.
 */
export const flagMissingFromPrint = (promptText: string, printedFlags: readonly string[]): string | undefined => {
  const code = codeLines(promptText);
  return LAUNCH_FLAGS_THE_PROBE_NEEDS.find(
    (flag) => code.some((line) => line.includes(flag)) && !printedFlags.includes(flag),
  );
};

/**
 * Builds the `unaskable` reason for a prompt file whose print cannot be trusted.
 *
 * @param detail - what is wrong with the print.
 * @returns the reason, prefixed with {@link STALE_PRINT_REASON}.
 */
export const stalePrintReason = (detail: string): string => `${STALE_PRINT_REASON}: ${detail}`;

/** What a caller does with one probe result, and the line it reports, if any. */
export interface WriteProbeOutcome {
  /** `proceed` to start agents, `refuse` to start none. */
  answer: 'proceed' | 'refuse';
  /** The text to report, without a caller prefix; absent when there is nothing to report. */
  message?: string;
}

/**
 * Turns one probe result into the answer both callers act on.
 *
 * An observed `no` refuses with {@link writeProbeRefusal}'s text. A stale print
 * proceeds and names the fix: refresh the print block from the shipped
 * template. Every other result proceeds silently.
 *
 * @param result - what the `WriteProbe` port returned.
 * @returns the answer and the line to report.
 */
export const writeProbeOutcome = (result: PortResult<WriteProbeReading>): WriteProbeOutcome => {
  if (result.ok) {
    return writeProbeAnswer(result.value) === 'refuse'
      ? { answer: 'refuse', message: writeProbeRefusal('no marker file appeared after the probe run') }
      : { answer: 'proceed' };
  }
  const reason = result.why === 'unaskable' ? result.reason : undefined;
  if (reason === undefined || !reason.startsWith(`${STALE_PRINT_REASON}: `)) return { answer: 'proceed' };
  return {
    answer: 'proceed',
    message:
      `The write probe did not run: ${reason.slice(STALE_PRINT_REASON.length + 2)}. Agents start without the probe. ` +
      `Fix: copy the PLOT_PRINT_INVOCATION block and the launch line from Plot's skills/plot/templates/worker-prompt.sh ` +
      `into .plot/worker-prompt.sh, so the print carries every flag the launch passes.`,
  };
};

/** How one probe run of the harness ended, as `runProcess` reports it. */
export interface ProbeRun {
  /** The exit code; `runProcess` reports 1 for a spawn failure, a signal and a timeout. */
  code: number;
  /** Set when the run did not end by itself. */
  interrupted?: 'timeout' | 'signal';
}

/**
 * Reads one probe run of the harness.
 *
 * Only a run that exited 0 by itself and left no marker observed a refused
 * write. A non-zero exit also covers a harness that could not start, an
 * expired login, a usage limit and a server error, none of which is a
 * permission fault, so it answers `unanswerable` and the start proceeds.
 *
 * @param run - how the harness run ended.
 * @param markerExists - whether the marker file exists after the run.
 * @returns `yes` when the marker exists; `no` for a clean exit 0 without it;
 *   `unanswerable` for a timeout, a signal or a non-zero exit without it.
 */
export const probeRunReading = (run: ProbeRun, markerExists: boolean): WriteProbeReading => {
  if (markerExists) return 'yes';
  if (run.interrupted !== undefined || run.code !== 0) return 'unanswerable';
  return 'no';
};
