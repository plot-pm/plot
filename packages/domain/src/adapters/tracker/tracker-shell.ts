import type { Issue } from '../../entities/issue.js';
import { LimitBasisSchema, type LimitBasis, type LimitReading } from '../../entities/limit.js';
import { answered, type PortResult } from '../../port-result.js';
import { asJson, asJsonLines, resultOf, runProcess, type ScriptRun } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** One issue as `plot-host.sh` reports it, before it is read as the entity. */
interface RawIssue {
  number?: number | string;
  title?: string;
  url?: string;
  createdAt?: string;
  body?: string;
  status?: string;
  statusCategory?: string;
}

/** One limit reading as `plot-host.sh` reports it. */
interface RawLimit {
  connector?: string;
  bucket?: string;
  limit?: number | null;
  remaining?: number | null;
  reset?: number | null;
  basis?: string;
}

/** Milliseconds in a second — the scripts report `reset` in epoch SECONDS. */
const MS_PER_SECOND = 1000;

/**
 * Reads one tracker issue as the domain's entity.
 *
 * The identifier stays a string. One tracker yields a number and another a
 * key, and comparing them as numbers is what makes a filter silently
 * always-false.
 *
 * `status` and `statusCategory` degrade to `''` rather than to a guess: an
 * op that reports no status (`issue-view`) and a tracker whose vocabulary has
 * no category for a state both mean *nothing was said*, and a default of
 * `To Do` would state a stage the tracker never claimed.
 *
 * @param raw - the script's JSON object.
 * @returns the issue; a null `body` means it was not fetched.
 */
export const issueOf = (raw: RawIssue): Issue => ({
  id: raw.number === undefined ? '' : String(raw.number),
  title: raw.title ?? '',
  url: raw.url ?? '',
  createdAt: raw.createdAt !== undefined && raw.createdAt !== '' ? raw.createdAt : null,
  body: raw.body ?? null,
  status: raw.status ?? '',
  statusCategory: raw.statusCategory ?? '',
});

/**
 * Reads a number the script may have reported as null, absent or nonsense.
 *
 * Absent is not zero: a `remaining` of 0 means the bucket is spent, while an
 * absent one means the connector did not say.
 */
const numberOr = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Reads one limit line as the domain's entity.
 *
 * An unrecognised basis degrades to `unknown`, and a reading whose basis is
 * `unknown` carries a null limit whatever the script said — a number tagged
 * *unknown* is the collapse the basis exists to refuse.
 *
 * @param raw - the script's JSON object.
 * @returns the reading, with `resetAt` in epoch MILLISECONDS.
 */
export const limitOf = (raw: RawLimit): LimitReading => {
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
 * What both connectors need in order to reach their own service.
 *
 * The scheme is passed to the script rather than read by it, which is what
 * makes each connector drive ONE arm. A script left to resolve the scheme
 * itself would let a GitHub connector answer with Jira issues the moment
 * somebody edited a config key — the branch this port exists to remove.
 */
export interface TrackerShell {
  /** Where the scripts and the repository are. */
  context: ShellContext;
  /** The scheme this connector drives, as `plot-host.sh` names it. */
  scheme: string;
  /** The tracker's address; `''` where it needs none. */
  baseUrl: string;
  /** The connector's own name, as its limit readings are tagged. */
  connector: string;
}

/**
 * The reading half both connectors share, holding no vendor decision.
 *
 * SHARED CODE IS NOT A SHARED BUDGET. Each connector calls this with its own
 * scheme and its own environment, so the two never see each other's tokens,
 * windows or refusals — what is shared here is the shape of a JSON line, which
 * is the script's contract rather than any vendor's.
 *
 * @param shell - the connector's context, scheme and address.
 * @param env - the environment the connector's credentials live in.
 * @returns the read operations, and the refusal the last one left behind.
 */
export const trackerReads = (shell: TrackerShell, env: Readonly<Record<string, string>>) => {
  const host = scriptPath(shell.context, 'plot-host.sh');
  const run = { cwd: shell.context.repoRoot, env };

  /**
   * Why the last call did not answer — the port's `lastRefusal`.
   *
   * Exit 4 is NOT a refusal. It says this connector cannot be asked at all,
   * which is a standing configuration fact rather than an incident worth
   * waiting out.
   */
  let refusal: string | null = null;

  const record = <T>(script: ScriptRun, parse: (stdout: string) => T): PortResult<T> => {
    refusal =
      script.code === 0 || script.code === 4
        ? null
        : script.stderr.trim() || script.stdout.trim() || `plot-host.sh exited ${script.code}`;
    return resultOf(script, parse);
  };

  const ask = async <T>(args: readonly string[], parse: (stdout: string) => T) =>
    record(await runProcess('bash', [host, ...args], run), parse);

  return {
    issueList: (limit?: number): Promise<PortResult<readonly Issue[]>> =>
      ask(['issue-list', ...(limit === undefined ? [] : ['--limit', String(limit)])], (stdout) =>
        asJsonLines<RawIssue>(stdout).map(issueOf),
      ),

    issueView: (id: string): Promise<PortResult<Issue>> =>
      ask(['issue-view', id], (stdout) => issueOf(asJson<RawIssue>(stdout))),

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => {
      const readings = await ask(['limit'], (stdout) => asJsonLines<RawLimit>(stdout).map(limitOf));
      if (!readings.ok) return readings;
      // ONLY THIS CONNECTOR'S BUCKETS. `plot-host.sh limit` reports whatever the
      // repository's git host meters, and a tracker reached through the same
      // script must not hand a caller the git host's headroom as its own. A
      // connector that meters nothing answers an empty list, which is an answer.
      return answered(readings.value.filter((reading) => reading.connector === shell.connector));
    },

    lastRefusal: (): string | null => refusal,

    /** Lets a write record its own refusal on the same reading. */
    refuse: (said: string | null): void => {
      refusal = said;
    },
  };
};
