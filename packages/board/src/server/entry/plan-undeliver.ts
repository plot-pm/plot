import {
  isRefusal,
  undeliver,
  type TransitionPlan,
  type TransitionResult,
} from '@plot-pm/domain/transitions/plan';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-undeliver.sh` runs, once per reversal.
 *
 * ```
 * printf '2026-09-09\tthe corpus slice was never built\n<the plan file>' \
 *   | node plot-plan-undeliver.mjs
 * approved	2026-09-09, the corpus slice was never built
 * ```
 *
 * **THE ONE LIFECYCLE MOVE THAT RUNS BACKWARDS, AND IT HAD NO ROUTE.** Every
 * forward move has a script owning its write — `plot-approve.sh`,
 * `plot-deliver.sh` — and returning a Delivered plan to Approved had none at
 * all, so it was done by editing the `State:` line. That is the shortcut
 * `the-master-agent-uses-the-controllers` exists to close, and a rule nothing
 * calls closes nothing: `setSprintState` sat exported with nine refusals and
 * zero callers while all three of its cases occurred in one afternoon.
 *
 * **THE PLAN ARRIVES AS TEXT, NOT AS A PATH.** The domain reaches no
 * filesystem, and a bundle that opened the file would put the one I/O call this
 * needs inside the artifact rather than in the shell that owns it. The caller
 * reads the file; this parses what it read.
 *
 * **A REFUSAL IS PRINTED, NOT SWALLOWED.** Seven can fire and each carries its
 * own sentence — *"a tag is public and a published package cannot be recalled"*
 * — and a caller reporting *"could not reverse"* would throw away the half a
 * person acts on. The rule that fired goes out beside it, so the shell can
 * branch without matching prose.
 *
 * **`refs` IS A READING THE SHELL TAKES.** A delivered plan's merged refs are
 * deleted by `plot-release-refs.sh`, and resolving one needs a git remote the
 * domain cannot reach. The caller measures it and sends it; this passes it
 * through untouched.
 */

/** What the caller sends: the date, the reason, the swept refs, and the plan. */
interface Request {
  /** The date to record, ISO-8601. */
  on: string;
  /** Why the delivery is being reversed. */
  why: string;
  /**
   * The branches whose refs are already gone, comma-separated, or `''`.
   *
   * `''` means the caller looked and found none — NOT that it did not look. A
   * caller that cannot measure refs sends the field empty and gets a decision,
   * which is the same answer it would have had before this reading existed.
   */
  sweptRefs: string;
  /** The whole plan file. */
  content: string;
}

/**
 * A `## Status` field: `- **Name:** value`.
 *
 * @param body - the plan file.
 * @param name - the field's name, as the file spells it.
 * @returns the trimmed value, or `''` where the file names no such field.
 */
const field = (body: string, name: string): string =>
  body.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'm'))?.[1].trim() ?? '';

/**
 * The plan's state, lowercased, or `none` where the file names none.
 *
 * **CARRIED THROUGH UNPARSED, so the RULE is what recognises it.** Narrowing
 * here would refuse in the parser's words and leave `state-unreadable` as dead
 * as the sprint rule's three refusals were — the property
 * `plot-sprint-transition.mjs` records for the same reason.
 *
 * @param content - the whole plan file.
 * @returns the state as written, lowercased, or `none`.
 */
const stateFrom = (content: string): string => {
  const written = field(content, 'State').toLowerCase();
  return written === '' ? 'none' : written;
};

/**
 * Parse the caller's three lines and the plan behind them.
 *
 * @param text - stdin: `<on>\t<why>\t<sweptRefs>\n<the plan file>`.
 * @returns the request.
 * @throws where stdin carries no newline, so no plan could follow the header.
 */
export const requestFrom = (text: string): Request => {
  const cut = text.indexOf('\n');
  if (cut < 0) throw new Error('expected a header line, a newline, then the plan file');
  const [on = '', why = '', sweptRefs = ''] = text.slice(0, cut).split('\t');
  return { on, why, sweptRefs, content: text.slice(cut + 1) };
};

/**
 * The slug a plan file names, or `''`.
 *
 * Read from `Slug:` where the file states one, and otherwise left empty: the
 * slug only reaches the refusal sentences, and inventing one from a filename
 * this bundle never sees would put a guess in the text a person acts on.
 *
 * @param content - the whole plan file.
 * @returns the slug, or `''`.
 */
const slugFrom = (content: string): string => field(content, 'Slug');

/**
 * Decide the reversal, or throw the refusal.
 *
 * @param request - what the caller sent.
 * @returns the decided phase and record, tab-separated and newline-terminated.
 * @throws a refusal carrying its `reason`, for {@link run} to print.
 */
export const answer = (request: Request): string => {
  const plan: TransitionPlan = {
    slug: slugFrom(request.content),
    phase: stateFrom(request.content) as TransitionPlan['phase'],
    review: 'pr',
    approvedRecord: field(request.content, 'Approved'),
    deliveredRecord: field(request.content, 'Delivered'),
    releasedRecord: field(request.content, 'Released'),
    rejectedRecord: field(request.content, 'Rejected'),
  };
  const swept = request.sweptRefs.trim();
  const result: TransitionResult = undeliver(plan, {
    on: request.on,
    why: request.why,
    // SENT ONLY WHERE THE CALLER MEASURED SOMETHING. An empty field is a
    // caller that looked and found none, and a `met: true` reading says so
    // without the rule having to tell the two apart.
    preconditions: swept === '' ? [] : [{ name: 'refs', met: false, detail: swept }],
  });
  if (isRefusal(result)) {
    const err = new Error(result.detail) as Error & { reason: string };
    err.reason = result.reason;
    throw err;
  }
  return `${result.phase}\t${result.record}\n`;
};

/**
 * Read stdin, print the answer.
 *
 * Three exit codes rather than two, because the caller repairs them
 * differently: a refusal is the plan's state and the operator reads the reason,
 * while unreadable input is the caller's own bug and no operator can act on it.
 *
 * @param text - the whole of stdin.
 * @param write - where the answer goes.
 * @returns the process exit code — 0 decided, 1 refused, 2 unreadable input.
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  let request: Request;
  try {
    request = requestFrom(text);
  } catch (err) {
    process.stderr.write(`plot-plan-undeliver: ${(err as Error).message}\n`);
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
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
