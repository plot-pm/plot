import type { Issue } from '../../entities/issue.js';
import {
  correctForRefusal,
  LimitBasisSchema,
  type LimitBasis,
  type LimitReading,
} from '../../entities/limit.js';
import type { Checks, Mergeability, Pr, PrState, ReviewVerdict } from '../../entities/pr.js';
import { answered, type PortResult } from '../../port-result.js';
import type {
  Host,
  HostBackend,
  LimitObservation,
  MergedAnswer,
  PrLookup,
} from '../../ports/host.js';
import { asJson, asJsonLines, asText, runProcess, runScript, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** One PR as `plot-host.sh` reports it, before it is read as the entity. */
interface RawPr {
  number?: number;
  repo?: string;
  head?: string;
  state?: string;
  mergedAt?: string | null;
  mergeCommit?: string;
  draft?: boolean;
  mergeable?: string;
  review?: string;
  checks?: string;
  failing_checks?: string[];
  url?: string;
  title?: string;
}

/** One limit reading as `plot-host.sh` reports it, before it is read as the entity. */
interface RawLimit {
  connector?: string;
  bucket?: string;
  limit?: number | null;
  remaining?: number | null;
  reset?: number | null;
  basis?: string;
}

/** One issue as `plot-host.sh` reports it. */
interface RawIssue {
  number?: number | string;
  title?: string;
  url?: string;
  createdAt?: string;
  body?: string;
}

const PR_STATES: readonly string[] = ['OPEN', 'MERGED', 'CLOSED'];
const MERGEABILITY: readonly string[] = ['mergeable', 'conflicting', 'unknown'];
const CHECKS: readonly string[] = ['green', 'pending', 'failing', 'none', 'unknown'];
const REVIEWS: readonly string[] = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', ''];

/**
 * Reads a host value against the set the entity allows.
 *
 * An unrecognised word becomes the fallback rather than being passed through:
 * the fallbacks here are all the "cannot verify" member of their enum, so a
 * host wording nobody has seen degrades toward unknown and never toward a
 * confident answer.
 */
const oneOf = <T extends string>(value: string | undefined, allowed: readonly string[], fallback: T): T =>
  value !== undefined && allowed.includes(value) ? (value as T) : fallback;

/**
 * Reads one host PR object as the domain's entity.
 *
 * @param raw - the host adapter's JSON object.
 * @returns the PR, with every unstated field at its cannot-verify value.
 */
const prOf = (raw: RawPr): Pr => ({
  number: raw.number ?? 0,
  repo: raw.repo ?? '',
  head: raw.head ?? '',
  state: oneOf<PrState>(raw.state, PR_STATES, 'OPEN'),
  mergedAt: raw.mergedAt ?? null,
  mergeCommit: raw.mergeCommit ?? '',
  draft: raw.draft ?? false,
  mergeable: oneOf<Mergeability>(raw.mergeable, MERGEABILITY, 'unknown'),
  review: oneOf<ReviewVerdict>(raw.review, REVIEWS, ''),
  checks: oneOf<Checks>(raw.checks, CHECKS, 'unknown'),
  failingChecks: raw.failing_checks ?? [],
  url: raw.url ?? '',
});

/**
 * Reads one host issue as the domain's entity.
 *
 * The identifier stays a string: GitHub yields a number and Jira a key, and
 * only one of them is a number by accident of the host.
 *
 * @param raw - the host adapter's JSON object.
 * @returns the issue; a null `body` means it was not fetched.
 */
const issueOf = (raw: RawIssue): Issue => ({
  id: raw.number === undefined ? '' : String(raw.number),
  title: raw.title ?? '',
  url: raw.url ?? '',
  createdAt: raw.createdAt !== undefined && raw.createdAt !== '' ? raw.createdAt : null,
  body: raw.body ?? null,
});

/** Milliseconds in a second — the script reports `reset` in epoch SECONDS. */
const MS_PER_SECOND = 1000;

/**
 * Reads a number the script may have reported as null, absent or nonsense.
 *
 * ABSENT IS NOT ZERO, and this is the one mapper where that costs something
 * real: a `remaining` of 0 means the bucket is spent and every call is refused,
 * while an absent one means the connector did not say. A fallback of 0 would
 * make an unreported field read as an exhausted budget.
 */
const numberOr = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Reads one limit line as the domain's entity.
 *
 * An unrecognised `basis` degrades to `unknown` rather than being passed
 * through — the same rule `oneOf` applies above, and the cannot-verify member
 * here is `unknown`. A word nobody has seen must never arrive as `actual`,
 * which is the one basis a caller is entitled to trust.
 *
 * A reading whose basis is `unknown` carries a null limit whatever the script
 * said: the two would otherwise be able to disagree, and a number tagged
 * *unknown* is the collapse this slice exists to refuse.
 *
 * @param raw - the script's JSON object.
 * @returns the reading, with `resetAt` in epoch MILLISECONDS.
 */
const limitOf = (raw: RawLimit): LimitReading => {
  const parsed = LimitBasisSchema.safeParse(raw.basis);
  const basis: LimitBasis = parsed.success ? parsed.data : 'unknown';
  const reset = numberOr(raw.reset);
  return {
    connector: raw.connector ?? '',
    bucket: raw.bucket ?? '',
    limit: basis === 'unknown' ? null : numberOr(raw.limit),
    remaining: numberOr(raw.remaining),
    resetAt: reset === null ? null : reset * MS_PER_SECOND,
    basis,
  };
};

/**
 * Reads the git host through `plot-host.sh`, the one place that speaks to a
 * host CLI.
 *
 * Neither `gh` nor `bb` is invoked here. The script already normalizes both
 * backends and already carries the exit-code contract this layer reads, so
 * calling a CLI directly would be a second implementation of the mapping the
 * script exists to hold.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `Host` backed by the shell adapter.
 */
export const hostShell = (context: ShellContext): Host => {
  const host = scriptPath(context, 'plot-host.sh');
  const inRepo = { cwd: context.repoRoot };
  const ask = <T>(args: readonly string[], parse: (stdout: string) => T) =>
    runScript('bash', [host, ...args], parse, inRepo);

  /**
   * The predictions this session has corrected, by `connector/bucket`.
   *
   * THE SESSION IS THE SCOPE, deliberately. A prediction corrected by a refusal
   * is worth more than the shipped guess and less than a measurement, so it
   * lives as long as the process that observed the refusal and no longer.
   * Persisting it is the budget record's question, and that is another slice.
   *
   * Only predictions are held. An `actual` reading is re-read from the response
   * headers of the next call, which is what makes it actual.
   */
  const corrected = new Map<string, number>();
  const keyOf = (reading: LimitReading): string => `${reading.connector}/${reading.bucket}`;

  /** Applies this session's corrections to a freshly-read prediction. */
  const withCorrections = (reading: LimitReading): LimitReading => {
    if (reading.basis !== 'predicted') return reading;
    const learnt = corrected.get(keyOf(reading));
    return learnt === undefined ? reading : { ...reading, limit: learnt };
  };

  /** The readings this session last saw, so an observation knows what to lower. */
  let lastRead: readonly LimitReading[] = [];

  return {
    backend: () =>
      ask(['backend'], (stdout) => {
        const value = asText(stdout);
        if (value !== 'github' && value !== 'bitbucket') {
          throw new Error(`plot-host: unrecognised backend ${value}`);
        }
        return value as HostBackend;
      }),

    prState: async (ref): Promise<PortResult<PrLookup>> => {
      const run = await runProcess('bash', [host, 'pr-state', String(ref)], inRepo);
      return resultOf(run, (stdout) => {
        const raw = asJson<RawPr & { state?: string }>(stdout);
        return raw.state === 'NONE' ? null : prOf(raw);
      });
    },

    prMerged: async (branch): Promise<PortResult<MergedAnswer>> => {
      const run = await runProcess('bash', [host, 'pr-merged', branch], inRepo);
      if (run.code === 3) return answered<MergedAnswer>('unknown');
      return resultOf(run, (stdout) => {
        const value = asText(stdout);
        if (value !== 'merged' && value !== 'not-merged' && value !== 'unknown') {
          throw new Error(`plot-host: unrecognised merge answer ${value}`);
        }
        return value as MergedAnswer;
      });
    },

    prList: (state, limit) =>
      ask(
        ['pr-list', '--state', state, ...(limit === undefined ? [] : ['--limit', String(limit)])],
        (stdout) => asJsonLines<RawPr>(stdout).map(prOf),
      ),

    issueList: (limit) =>
      ask(
        ['issue-list', ...(limit === undefined ? [] : ['--limit', String(limit)])],
        (stdout) => asJsonLines<RawIssue>(stdout).map(issueOf),
      ),

    issueView: async (id) => {
      const run = await runProcess('bash', [host, 'issue-view', id], inRepo);
      return resultOf(run, (stdout) => issueOf(asJson<RawIssue>(stdout)));
    },

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => {
      // TWO CONNECTORS, ASKED SEPARATELY, because they are separate axes. The
      // git host and CI are chosen independently — this repo is GitHub +
      // Actions, `ekzweb` is Bitbucket + Jenkins — and GitHub Actions minutes
      // are a quota distinct from the API's, so "the connector is github" does
      // not identify the bucket.
      const git = await runProcess('bash', [host, 'limit'], inRepo);
      const gitReadings = resultOf(git, (stdout) =>
        asJsonLines<RawLimit>(stdout).map(limitOf),
      );
      // The git host is the one that must answer. A CI connector that cannot be
      // asked contributes nothing rather than failing the whole reading: a
      // Jenkins that is down says nothing about the GitHub budget the caller
      // came for.
      if (!gitReadings.ok) return gitReadings;
      const ci = await runProcess('bash', [host, 'ci-limit'], inRepo);
      const ciReadings = resultOf(ci, (stdout) =>
        asJsonLines<RawLimit>(stdout).map(limitOf),
      );
      const all = [...gitReadings.value, ...(ciReadings.ok ? ciReadings.value : [])].map(
        withCorrections,
      );
      lastRead = all;
      return answered(all);
    },

    observe: (observed: LimitObservation): void => {
      // A refusal lowers every prediction this session has read, and touches no
      // `actual` one. Nothing here asks the host: an observation is evidence
      // the caller already holds, and spending a request to record it would be
      // the failure mode in miniature.
      if (observed !== 'throttled') return;
      for (const reading of lastRead) {
        const lowered = correctForRefusal(withCorrections(reading), observed);
        if (lowered.limit !== null && lowered.basis === 'predicted') {
          corrected.set(keyOf(reading), lowered.limit);
        }
      }
    },
  };
};
