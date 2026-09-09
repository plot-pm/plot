import {
  composeAdoption,
  isAdoptionRefusal,
  type AdoptionAnswers,
  type AdoptionInput,
  type AdoptionReadings,
  type AdoptionResult,
} from '@plot-pm/domain/rules/adoption';
import { proposeStack, type StackProposal } from '@plot-pm/domain/rules/stack';
import { readingsFrom } from './stack-readings.js';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-write-config.sh` runs, once per adoption.
 *
 * ```
 * node plot-adopt.mjs < request.json
 * {"outcome":"decided","hub":"CLAUDE.md","keys":[…],"ignoreLine":".worktrees/"}
 * ```
 *
 * **THE CONTROLLER FOR THE ONE COMMAND THAT WRITES INTO A REPOSITORY PLOT DOES
 * NOT OWN.** Adoption runs in a repository that has no board, no plans and no
 * `.plot/` — so the controller is reached the way every other skill reaches one
 * without HTTP, through a bundle. `plot-ask.mjs` is the seam
 * `a-shell-script-asks-the-domain` built and this is a sibling of it, for the
 * reason `propose-stack.ts` states: a caller asking what a repository's config
 * should be must not load the fleet controller to get an answer.
 *
 * **IT ASKS `composeAdoption` AND STOPS ON ITS ANSWER.** An endpoint that only
 * spawned would be a shell — the plan measures three of those on the board
 * today, `{"available":true}` in front of a script with zero rule calls. This
 * one performs nothing at all: it decides, and `plot-write-config.sh` applies
 * what it decided.
 *
 * **THE PROPOSALS ARE `proposeStack`'S.** The probe's report arrives whole and
 * `readingsFrom` — the module `plot-propose-stack.mjs` reads it from too — turns
 * it into the readings the rule judges, so a repository cannot get one answer
 * from the proposal bundle and a different one from this. A caller that already has the
 * proposal may hand it back instead; both paths reach the same values.
 *
 * **JSON IN, JSON OUT**, where the transition entries take tab-separated words.
 * The request nests a probe report inside it and the answer nests a key list, so
 * a flat wire would mean the skill re-assembling a shape it just took apart.
 */

/** What a caller asks: the probe's report, what a person answered, and whether one is there. */
export interface Request {
  /** The merged probe report, as `plot-detect-repo.sh` prints it. */
  readonly report: Record<string, unknown>;
  /** The proposals, where the caller already has them; recomputed from the report otherwise. */
  readonly proposal: StackProposal | null;
  /** What a person confirmed. */
  readonly answers: AdoptionAnswers;
  /** Whether `PLOT_UNATTENDED=1` is set — it changes what a refusal says, never which fire. */
  readonly unattended: boolean;
}

/**
 * Read one string from a request.
 *
 * @param value what the field held
 * @returns the string, or `''` where the field was absent or not a string
 */
const stringOr = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Read a list of strings from a request.
 *
 * AN ABSENT LIST IS EMPTY, and for the Definition of Done that is a REFUSAL
 * rather than an empty Definition — the rule owns that reading. Nothing is
 * invented here to make the request look answered.
 *
 * @param value what the field held
 * @returns the strings, dropping anything that is not one
 */
const stringsOr = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Turn a probe report into the readings adoption decides by.
 *
 * `hub_docs` arrives as the probe's own space- or comma-separated list, because
 * that is what `plot-detect-repo.sh` prints. It is split here rather than in the
 * rule: the rule takes values, and which punctuation a collector chose is the
 * adapter's problem.
 *
 * @param report the merged probe report
 * @returns the readings, with every absent field read as *nothing was found*
 */
export const adoptionReadingsFrom = (report: Record<string, unknown>): AdoptionReadings => ({
  hasPlotConfig: report.has_plot_config === true || report.has_plot_config === 'true',
  hubDocs: Array.isArray(report.hub_docs)
    ? report.hub_docs.filter((v): v is string => typeof v === 'string')
    : stringOr(report.hub_docs).split(/[,\s]+/).filter((s) => s !== ''),
  gitHost: stringOr(report.git_host),
});

/**
 * Read the answers a person gave.
 *
 * @param value the request's `answers` object, or anything else
 * @returns the answers, every absent field read as *not answered*
 */
export const answersFrom = (value: unknown): AdoptionAnswers => {
  const given = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return {
    hub: stringOr(given.hub),
    definitionOfDone: stringsOr(given.definitionOfDone),
    tracker: stringOr(given.tracker),
    trackerUrl: stringOr(given.trackerUrl),
    ci: stringOr(given.ci),
    worktreeRoot: stringOr(given.worktreeRoot),
  };
};

/**
 * Parse one request.
 *
 * @param text the whole of stdin, one JSON object
 * @returns the request
 * @throws when stdin is not one JSON object carrying a `report` object
 */
export const requestFrom = (text: string): Request => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected one JSON object on stdin');
  }
  const body = parsed as Record<string, unknown>;
  const report = body.report;
  if (typeof report !== 'object' || report === null || Array.isArray(report)) {
    throw new Error("expected a 'report' object — the probe's own JSON, unmodified");
  }
  const proposal = body.proposal;
  return {
    report: report as Record<string, unknown>,
    proposal:
      typeof proposal === 'object' && proposal !== null && !Array.isArray(proposal)
        ? (proposal as StackProposal)
        : null,
    answers: answersFrom(body.answers),
    unattended: body.unattended === true,
  };
};

/**
 * Decide one adoption.
 *
 * @param request what the caller asked
 * @returns the domain's result — the keys to write, or the rule that refused
 */
export const decide = (request: Request): AdoptionResult => {
  const input: AdoptionInput = {
    readings: adoptionReadingsFrom(request.report),
    proposal: request.proposal ?? proposeStack(readingsFrom(request.report)),
    answers: request.answers,
    unattended: request.unattended,
  };
  return composeAdoption(input);
};

/**
 * Read stdin, print the decision.
 *
 * Three exit codes, because the caller repairs them differently. A refusal is
 * the repository's own state and the operator reads the sentence; unreadable
 * input is the caller's bug and no operator can act on it.
 *
 * A REFUSAL IS PRINTED WHOLE, as JSON on stdout, and not only as a message on
 * stderr: the `unasked` list is what an unattended run turns into its
 * `PLOT-UNASKED` lines, and a caller that had to scrape it out of a sentence
 * would be re-deriving what the rule already answered.
 *
 * @param text the whole of stdin
 * @param write where the answer goes
 * @returns the process exit code — 0 decided, 1 refused, 2 unreadable input
 */
export const run = (
  text: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): number => {
  let request: Request;
  try {
    request = requestFrom(text);
  } catch (err) {
    process.stderr.write(`plot-adopt: ${(err as Error).message}\n`);
    return 2;
  }
  const result = decide(request);
  write(`${JSON.stringify(result)}\n`);
  if (isAdoptionRefusal(result)) {
    process.stderr.write(`${result.reason}\t${result.detail}\n`);
    return 1;
  }
  return 0;
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
