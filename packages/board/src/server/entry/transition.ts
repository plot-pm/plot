import {
  approve,
  deliver,
  release,
  isRefusal,
  type Phase,
  type TransitionPlan,
  type TransitionResult,
} from '@plot-pm/domain/transitions/plan';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-approve.sh` and `plot-deliver.sh` run, once per
 * transition.
 *
 * ```
 * printf 'deliver\tslug\tapproved\tpr\t\t\t\t2026-09-02\t\n' | node plot-transition.mjs
 * Delivered	2026-09-02	write
 * ```
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
      // The parser spells an unreadable phase `NONE`, and the shell spells an
      // absent field `''`. Both mean unmeasured, which the domain calls `none`
      // — and `none` refuses rather than proceeding, so neither collapses into
      // a phase that would let the transition through.
      phase: (phase === '' || phase === 'NONE' ? 'none' : phase.toLowerCase()) as Phase,
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

/**
 * Render one decided transition: `phase TAB record TAB action`.
 *
 * The action is `write` or `already` — whether the plan still owes this
 * transition its two lines. It is the domain's `alreadyRecorded`, named for
 * what the caller does with it rather than for what it observed, because the
 * caller's next act is a write or a skip.
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
  }\n`;
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
  process.exit(run(Buffer.concat(chunks).toString('utf8')));
}
