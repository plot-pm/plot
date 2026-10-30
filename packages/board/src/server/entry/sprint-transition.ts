import {
  SprintStateSchema,
  itemsFrom,
  sprintFrom,
} from '@plot-pm/domain/entities/sprint';
import {
  isRefusal,
  setSprintState,
  type TransitionResult,
} from '@plot-pm/domain/transitions/sprint';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/** Re-exported for this module's existing importers; both now live in the domain beside `sprintMembers`. */
export { itemsFrom, sprintFrom };

/**
 * The `node` entry point `plot-sprint-state.sh` runs, once per transition.
 *
 * ```
 * printf 'Active\t2026-09-09\n<the sprint file>' | node plot-sprint-transition.mjs
 * Active
 * ```
 *
 * **THE RULE IS FINISHED AND DEAD, AND THIS IS THE WIRE.**
 * `transitions/sprint.ts` names nine refusals, carries a full test file and is
 * exported from `index.ts`; measured 2026-09-08 its only caller outside
 * `packages/domain/` was its own test. On that afternoon a master agent wrote
 * `State: Planned` into a sprint file with `sed`, activated it, and three of
 * those nine refusals — `state-unrecognised`, `commitment-empty` and
 * `state-unreachable` — sat exported and silent while all three of their cases
 * occurred.
 *
 * **A SIXTH artifact, for the reason the fifth one gives.**
 * `entry/transition.ts` records it: `plot-ask.mjs` answers `board` and `fleet`
 * by RUNNING `plot-fleet-scan.sh`, so a script asking the board for its
 * transition would be a script calling an artifact that calls the script. This
 * bundle spawns nothing and reads nothing — the sprint arrives on stdin.
 *
 * **THE SPRINT ARRIVES AS TEXT, NOT AS A PATH.** The domain reaches no
 * filesystem, and a bundle that opened the file would put the one I/O call this
 * rule needs inside the artifact rather than in the shell that owns it. The
 * caller reads the file; this parses what it read.
 *
 * **A REFUSAL IS PRINTED, NOT SWALLOWED.** Each of the nine carries its own
 * sentence — *"'Planned' is not a sprint state — the four are Planning,
 * Committed, Active, Closed"* — and a caller reporting *"could not start
 * sprint"* would throw away the half a person acts on. The rule that fired goes
 * out beside it, so the shell can branch without matching prose.
 */

/** What a transition asks of its caller. */
export interface Request {
  /** The state to move to, as the caller spells it. */
  to: string;
  /** The date to record on a close, ISO-8601; `''` for any other move. */
  on: string;
  /** The sprint file, whole. */
  content: string;
  /** The sprint's identity, cut from its filename. */
  slug: string;
}

/**
 * Parse one request: `to TAB on TAB slug NEWLINE <the sprint file>`.
 *
 * The header is one line and everything after it is the file, so a sprint
 * carrying tabs, blank lines or its own `## Status` block travels unescaped.
 *
 * A header short of three fields is NOT padded. A missing `on` would read as
 * `''` — the spelling for *no date given* — and a close would then refuse with
 * `close-date-missing` where the caller had in fact supplied one, which reports
 * the caller's bug as the sprint's state.
 *
 * @param text - the whole of stdin.
 * @returns the request.
 * @throws when the first line is not three tab-separated fields.
 */
export const requestFrom = (text: string): Request => {
  const split = text.indexOf('\n');
  if (split === -1) {
    throw new Error('expected a header line and a sprint file, got one line');
  }
  const fields = text.slice(0, split).split('\t');
  if (fields.length !== 3) {
    throw new Error(
      `expected 3 tab-separated header fields, got ${fields.length}: '${text.slice(0, split)}'`,
    );
  }
  const [to, on, slug] = fields as [string, string, string];
  return { to, on, slug, content: text.slice(split + 1) };
};

/**
 * Decide one transition.
 *
 * @param request - what the caller asked.
 * @returns the domain's result.
 */
export const decide = (request: Request): TransitionResult =>
  setSprintState(sprintFrom(request.content, request.slug), {
    to: request.to,
    on: request.on,
  });

/**
 * Render one decided transition: `state TAB actualEnd`.
 *
 * The state is the file's own spelling, which is the domain's here — a sprint
 * file writes `Active` and `SprintStateSchema` holds that word, so no
 * translation table stands between them and none can drift.
 *
 * @param request - what the caller asked.
 * @returns the answer line, newline-terminated.
 * @throws when the transition refused, carrying the refusal's own words.
 */
export const answer = (request: Request): string => {
  const result = decide(request);
  if (isRefusal(result)) {
    const refusal = new Error(result.detail) as Error & { reason: string };
    refusal.reason = result.reason;
    throw refusal;
  }
  return `${result.state}\t${result.actualEnd ?? ''}\n`;
};

/**
 * The four states, one per line.
 *
 * **THE PHASE WORD COMES FROM THE SCHEMA**, so a fifth cannot be invented by
 * whoever writes the next skill: a caller that would have hardcoded the list
 * asks for it instead.
 *
 * @returns the states in lifecycle order, newline-terminated.
 */
export const states = (): string => `${SprintStateSchema.options.join('\n')}\n`;

/**
 * Read stdin, print the answer.
 *
 * Three exit codes rather than two, because the caller repairs them
 * differently: a refusal is the sprint's state and the operator reads the
 * reason, while unreadable input is the caller's own bug and no operator can
 * act on it.
 *
 * @param text - the whole of stdin.
 * @param write - where the answer goes.
 * @param argv - the process arguments, for `--states`.
 * @returns the process exit code — 0 decided, 1 refused, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  argv: readonly string[] = [],
): number => {
  if (argv.includes('--states')) {
    write(states());
    return 0;
  }
  let request: Request;
  try {
    request = requestFrom(text);
  } catch (err) {
    process.stderr.write(`plot-sprint-transition: ${(err as Error).message}\n`);
    return 2;
  }
  try {
    write(answer(request));
    return 0;
  } catch (err) {
    const reason = (err as { reason?: string }).reason ?? 'refused';
    process.stderr.write(`${reason}\t${(err as Error).message}\n`);
    return 1;
  }
};

// Only when RUN, never when imported.
//
// `pathToFileURL` RATHER THAN A TEMPLATE, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const chunks: Buffer[] = [];
  // `--states` answers without reading stdin: a caller asking which words exist
  // has no sprint to send, and waiting on a stdin nobody writes would hang it.
  if (!process.argv.includes('--states')) {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  }
  void endEntry(run(Buffer.concat(chunks).toString('utf8'), undefined, process.argv));
}
