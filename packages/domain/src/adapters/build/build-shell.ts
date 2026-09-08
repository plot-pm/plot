import type { BuildRun, ShaRun } from '../../entities/build.js';
import { LimitBasisSchema, type LimitBasis, type LimitReading } from '../../entities/limit.js';
import { answered, type PortResult } from '../../port-result.js';
import { asJson, asJsonLines, resultOf, runProcess, type ScriptRun } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** One run as `plot-host.sh runs` reports it. */
interface RawRun {
  workflow?: string;
  conclusion?: string;
  startedAt?: string;
  url?: string;
}

/** One run as `plot-host.sh run-for-sha` reports it. */
interface RawShaRun {
  sha?: string;
  status?: string;
  conclusion?: string | null;
  url?: string;
  startedAt?: string;
}

/** One limit reading as `plot-host.sh ci-limit` reports it. */
interface RawLimit {
  connector?: string;
  bucket?: string;
  limit?: number | null;
  remaining?: number | null;
  reset?: number | null;
  basis?: string;
}

/** Milliseconds in a second — the script reports `reset` in epoch SECONDS. */
const MS_PER_SECOND = 1000;

/**
 * Reads one history line as the domain's entity.
 *
 * The conclusion is passed THROUGH rather than read against a set. It is
 * documented as verbatim, and narrowing it would turn every outcome the CI
 * system adds next into the same word as the ones it already has.
 *
 * @param raw - the script's JSON object.
 * @returns the run, with every unstated field empty.
 */
export const runOf = (raw: RawRun): BuildRun => ({
  workflow: raw.workflow ?? '',
  conclusion: raw.conclusion ?? '',
  startedAt: raw.startedAt ?? '',
  url: raw.url ?? '',
});

/**
 * Reads one sha-pinned run as the domain's entity.
 *
 * `conclusion` KEEPS ITS NULL. The script prints null for a run still going,
 * and an empty string here would read as a conclusion the system reported —
 * the one field on this shape where absent and empty are different facts.
 *
 * @param raw - the script's JSON object.
 * @returns the run, with every other unstated field empty.
 */
export const shaRunOf = (raw: RawShaRun): ShaRun => ({
  sha: raw.sha ?? '',
  status: raw.status ?? '',
  conclusion: raw.conclusion === undefined || raw.conclusion === '' ? null : raw.conclusion,
  url: raw.url ?? '',
  startedAt: raw.startedAt ?? '',
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

/** What a connector needs in order to reach its own CI system. */
export interface BuildShell {
  /** Where the scripts and the repository are. */
  context: ShellContext;
  /** The CI system this connector drives, as `plot-host.sh` names it. */
  system: string;
}

/**
 * The reading half a shell-backed CI connector shares, holding no vendor
 * decision.
 *
 * SHARED CODE IS NOT A SHARED BUDGET. Each connector calls this with its own
 * system and its own environment, so two never see each other's tokens,
 * windows or refusals — what is shared here is the shape of a JSON line, which
 * is the script's contract rather than any vendor's.
 *
 * @param shell - the connector's context and system word.
 * @param env - the environment the connector's credentials live in.
 * @returns the three operations, and the refusal the last one left behind.
 */
export const buildReads = (shell: BuildShell, env: Readonly<Record<string, string>>) => {
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
    runs: (branch: string, limit?: number): Promise<PortResult<readonly BuildRun[]>> =>
      ask(
        ['runs', branch, ...(limit === undefined ? [] : ['--limit', String(limit)])],
        (stdout) => asJsonLines<RawRun>(stdout).map(runOf),
      ),

    runForSha: (branch: string, sha: string, limit?: number): Promise<PortResult<ShaRun | null>> =>
      ask(
        ['run-for-sha', branch, sha, ...(limit === undefined ? [] : ['--limit', String(limit)])],
        (stdout) => {
          // EMPTY IS AN ANSWER, and the common one. The script prints nothing
          // where the branch has no runs at all, which is what a caller polling
          // a fresh push sees on every pass until CI wakes up. Handing that to
          // the JSON parser would report a healthy poll as a broken call.
          if (stdout.trim() === '') return null;
          return shaRunOf(asJson<RawShaRun>(stdout));
        },
      ),

    limit: async (): Promise<PortResult<readonly LimitReading[]>> => {
      const readings = await ask(['ci-limit'], (stdout) =>
        asJsonLines<RawLimit>(stdout).map(limitOf),
      );
      if (!readings.ok) return readings;
      // ONLY THIS CONNECTOR'S BUCKETS, the rule the tracker's read half states
      // for the same reason: a connector must not hand a caller another
      // service's headroom as its own. A connector that meters nothing answers
      // an empty list, which is an answer.
      return answered(readings.value.filter((reading) => reading.connector === shell.system));
    },

    lastRefusal: (): string | null => refusal,
  };
};
