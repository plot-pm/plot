import type { Issue } from '../../entities/issue.js';
import type { Checks, Mergeability, Pr, PrState, ReviewVerdict } from '../../entities/pr.js';
import { answered, type PortResult } from '../../port-result.js';
import type { Host, HostBackend, MergedAnswer, PrLookup } from '../../ports/host.js';
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
  };
};
