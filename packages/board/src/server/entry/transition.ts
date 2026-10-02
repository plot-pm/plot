import {
  approve,
  deliver,
  release,
  isRefusal,
  type TransitionPlan,
  type TransitionResult,
} from '@plot-pm/domain/transitions/plan';
import { planStateOf } from '@plot-pm/domain/entities/plan';
import {
  unnamedBranchDetail,
  unnamedBranches,
  type NamedSlice,
} from '@plot-pm/domain/rules/slice-name';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-approve.sh` and `plot-deliver.sh` run, once per
 * transition.
 *
 * ```
 * printf 'deliver\tslug\tapproved\tpr\t\t\t\t2026-09-02\t\t\t\n' | node plot-transition.mjs
 * Delivered	2026-09-02	write	no
 * ```
 *
 * It also answers ONE other question, by argument rather than by field:
 * `--check-slices <slug>` reads the parser's `waves[]` as JSON and exits 1
 * where the plan names a branch under no `###` heading. See
 * {@link checkSlices} for why it is not a twelfth field.
 *
 * **A FIFTH artifact, for the reason the third and fourth ones give.**
 * `plot-ask.mjs` answers `board` and `fleet` by RUNNING `plot-fleet-scan.sh`,
 * and the board's own approve route SPAWNS `plot-approve.sh` — so a script
 * asking the board for its transition would be a script calling an artifact
 * that calls the script. This bundle spawns nothing and reads nothing.
 *
 * **One answer, not two, and that is the whole slice.** The scripts composed
 * their phase flip and their record as two independent steps, and the failure
 * that closes here is what independence permits: measured 2026-08-20, a plan
 * flipped to `Phase: Delivered` with no `Delivered:` line was filtered out of
 * `plot-fleet-scan.sh` entirely, because the scan reads its delivered window
 * from `delivered_raw` — the record itself. The domain's `Decision` requires
 * both fields, so a phase with no record does not typecheck; this line makes
 * that property reach the shell, which is where the two came apart.
 *
 * **Tab-separated in, tab-separated out.** The caller is bash, and a JSON round
 * trip would mean `jq` per transition — a second process to avoid a second
 * format. It is the format `plot-verdicts.mjs` and `plot-movable.mjs` already
 * speak to the same callers.
 */

/** The lifecycle steps a script asks for. */
export type Verb = 'approve' | 'deliver' | 'release';

/** What a transition asks of its caller: the plan's readings and the values to record. */
export interface Request {
  /** Which lifecycle step. */
  verb: Verb;
  /** The plan the transition is about. */
  plan: TransitionPlan;
  /** The date to record, ISO-8601. */
  on: string;
  /** The approver's name — `approve` only. */
  who: string;
  /** How the approval happened — `approve` only. */
  channel: string;
  /** The version to record — `release` only. */
  version: string;
}

/** The `## Status` phase spelling each verb writes, as the plan file spells it. */
const SPELLING: Readonly<Record<Verb, string>> = {
  approve: 'Approved',
  deliver: 'Delivered',
  release: 'Released',
};

/**
 * Parse one request: `verb TAB slug TAB phase TAB review TAB approved TAB
 * delivered TAB released TAB on TAB who TAB channel TAB version`.
 *
 * A line short of eleven fields is NOT padded. A missing record field would
 * read as `''` — the spelling for *no record written yet* — and the transition
 * would then decide to write one over a record that exists, replacing a dated
 * approval with today's. So a malformed line refuses the whole request rather
 * than inventing the most destructive reading for it.
 *
 * @param text the stdin document, one request
 * @returns the request
 * @throws when the line is not eleven tab-separated fields, or names no verb
 */
export const requestFrom = (text: string): Request => {
  const fields = text.replace(/\n$/, '').split('\t');
  if (fields.length !== 11) {
    throw new Error(
      `expected 11 tab-separated fields, got ${fields.length}: '${text.replace(/\n$/, '')}'`,
    );
  }
  const [verb, slug, phase, review, approved, delivered, released, on, who, channel, version] =
    fields as [string, string, string, string, string, string, string, string, string, string, string];
  if (verb !== 'approve' && verb !== 'deliver' && verb !== 'release') {
    throw new Error(`unknown verb '${verb}' — expected approve, deliver or release`);
  }
  return {
    verb,
    plan: {
      slug,
      // THE PLAN ENTITY ANSWERS THIS — `planStateOf`. It was a cast here, and
      // the cast is what let `UNKNOWN` become the string `'unknown'`: a value
      // `PlanState` does not admit, typechecking only because the cast silenced
      // it, and reaching every `switch` in `transitions/plan.ts` as an unhandled
      // default. The refusal it produced was right by accident.
      //
      // The three absences still collapse to `none` and still refuse rather
      // than proceeding — the parser's `NONE` for a file stating no phase, its
      // `UNKNOWN` for one it cannot read, and the shell's `''` for an unset
      // field. What changes is that a total function decides it, so no phase
      // reaches a transition as a word the type does not admit.
      phase: planStateOf(phase),
      review: review === '' || review === 'NONE' ? 'none' : review,
      approvedRecord: approved,
      deliveredRecord: delivered,
      releasedRecord: released,
    },
    on,
    who,
    channel,
    version,
  };
};

/**
 * Decide one transition.
 *
 * @param request what the caller asked
 * @returns the domain's result
 */
export const decide = (request: Request): TransitionResult => {
  switch (request.verb) {
    case 'approve':
      return approve(request.plan, {
        on: request.on,
        who: request.who,
        channel: request.channel,
      });
    case 'deliver':
      return deliver(request.plan, { on: request.on });
    case 'release':
      return release(request.plan, { on: request.on, version: request.version });
  }
};

/** The record the plan already carries for this verb, or `''`. */
const written = (request: Request): string => {
  switch (request.verb) {
    case 'approve':
      return request.plan.approvedRecord.trim();
    case 'deliver':
      return request.plan.deliveredRecord.trim();
    case 'release':
      return request.plan.releasedRecord.trim();
  }
};

/**
 * Render one decided transition: `phase TAB record TAB action TAB recorded`.
 *
 * The action is `write` or `already` — whether the plan still owes this
 * transition anything at all. It is the domain's `alreadyRecorded`, named for
 * what the caller does with it rather than for what it observed.
 *
 * `recorded` is `yes` where the plan ALREADY carries a record for this verb,
 * and it is not the same question. A plan can carry a record while its phase
 * still lags — someone wrote the line by hand, or an earlier run was cut
 * between the two writes — and the caller must then flip the phase WITHOUT
 * inserting a second record. The domain returns the written record unchanged
 * in that case, so the two fields together say *this is the line, and it is
 * already in the file*.
 *
 * The phase is the file's spelling rather than the domain's: the domain
 * normalizes to lower case, and a plan file writes `Delivered`.
 *
 * @param request what the caller asked
 * @returns the answer line, newline-terminated
 * @throws when the transition refused, carrying the refusal's own words
 */
export const answer = (request: Request): string => {
  const result = decide(request);
  if (isRefusal(result)) {
    const refusal = new Error(result.detail) as Error & { reason: string };
    refusal.reason = result.reason;
    throw refusal;
  }
  return `${SPELLING[request.verb]}\t${result.record}\t${
    result.alreadyRecorded ? 'already' : 'write'
  }\t${written(request) === '' ? 'no' : 'yes'}\n`;
};

/**
 * Answer whether a plan names a branch under no slice heading.
 *
 * **A SECOND QUESTION ON ONE BUNDLE, ASKED BY ARGUMENT RATHER THAN BY FIELD.**
 * {@link requestFrom} refuses any line that is not exactly eleven fields and
 * does not pad, so a twelfth field would have to be added to every sender in
 * one commit. The slices are a different shape anyway — a nested list, not a
 * scalar — so they arrive as the parser's own JSON and the tab-separated
 * contract is untouched.
 *
 * Asked BEFORE the merge by `plot-approve.sh`, where the other three refusals
 * sit. The transition itself asks the same rule, so a caller that skips this
 * check is still refused; what this buys is a refusal the operator meets while
 * the plan PR is still open and nothing has been written.
 *
 * @param text the stdin document — the parser's `waves[]` as JSON, or a whole
 *   `plot-plan-meta.sh` object carrying it
 * @param slug the plan the answer is about, for the refusal's wording
 * @param write where the refusal goes
 * @returns the process exit code — 0 every branch is named, 1 one is not,
 *   2 the slices could not be read
 */
export const checkSlices = (
  text: string,
  slug: string,
  write: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  let slices: readonly NamedSlice[];
  try {
    const parsed: unknown = JSON.parse(text);
    // The caller may pipe the whole meta object or just its `waves[]`. Either
    // is read; anything else is refused rather than treated as a plan naming
    // no branch, which would approve the very shape this gate exists for.
    const waves = Array.isArray(parsed)
      ? parsed
      : (parsed as { waves?: unknown } | null)?.waves;
    if (!Array.isArray(waves)) {
      write("plot-transition: expected the parser's waves[] — refusing rather than guessing.\n");
      return 2;
    }
    slices = waves.map((wave) => {
      const w = (wave ?? {}) as { name?: unknown; branches?: unknown };
      return {
        name: typeof w.name === 'string' ? w.name : '',
        branches: (Array.isArray(w.branches) ? w.branches : []).map((line) => {
          const l = (line ?? {}) as { branch?: unknown; deferred?: unknown };
          return {
            branch: typeof l.branch === 'string' ? l.branch : '',
            deferred: l.deferred === true,
          };
        }),
      };
    });
  } catch {
    write('plot-transition: cannot read the slices as JSON — refusing rather than guessing.\n');
    return 2;
  }
  const unnamed = unnamedBranches(slices);
  if (unnamed.length === 0) return 0;
  write(`slice-unnamed\t${unnamedBranchDetail(slug, unnamed)}\n`);
  return 1;
};

/**
 * Read stdin, print the answer.
 *
 * Three exit codes rather than two, because the caller repairs them
 * differently: a refusal is the plan's state and the operator reads the reason,
 * while unreadable input is the caller's own bug and no operator can act on it.
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
    process.stderr.write(`plot-transition: ${(err as Error).message}\n`);
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
  const text = Buffer.concat(chunks).toString('utf8');
  const flag = process.argv.indexOf('--check-slices');
  process.exit(flag === -1 ? run(text) : checkSlices(text, process.argv[flag + 1] ?? ''));
}
