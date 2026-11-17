import type { BuildRun, ShaRun, WorkflowShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, failed, unaskable, type PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';
import { runProcess } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { buildReads, runOf, shaRunOf, workflowShaRunOf } from './build-shell.js';
import { jenkinsReads, type JenkinsApi } from './jenkins-api.js';

/** The system word `plot-host.sh` knows this connector by, and tags its limit with. */
const SYSTEM = 'jenkins';

/**
 * Maps a Jenkins `result` word to the conclusion word the domain folds.
 *
 * `SUCCESS` passes; `FAILURE` and `UNSTABLE` fail (a build whose tests failed
 * is red); `ABORTED` is `cancelled`; `NOT_BUILT` is `unknown`, because nothing
 * ran. A null conclusion (still building) and any word Jenkins adds later pass
 * through unchanged, so the fold reads the second as `unknown`.
 *
 * @param conclusion - Jenkins' `result` word, or null while the build runs.
 * @returns the conclusion word `foldRuns` reads.
 */
export const jenkinsConclusion = (conclusion: string | null): string | null => {
  switch (conclusion) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
    case 'UNSTABLE':
      return 'failure';
    case 'ABORTED':
      return 'cancelled';
    case 'NOT_BUILT':
      return 'unknown';
    default:
      return conclusion;
  }
};

/**
 * Keeps the newest build per commit and workflow.
 *
 * Jenkins lists every build that ran for a commit, so a failed build #41 and
 * a green rebuild #42 of one commit arrive together, and `foldRuns` reads
 * red first. The rebuild is the commit's state. Newest is the later
 * `startedAt`; a run with no `startedAt` loses to one with it, and between
 * equals the earlier-listed run (Jenkins lists newest first) is kept.
 *
 * @param runs - every build Jenkins ran for one commit.
 * @returns one run per `sha` and `workflow`, in the order first listed.
 */
export const newestPerSha = (runs: readonly WorkflowShaRun[]): WorkflowShaRun[] => {
  const newest = new Map<string, WorkflowShaRun>();
  for (const run of runs) {
    const key = `${run.sha}\u0000${run.workflow}`;
    const held = newest.get(key);
    if (held === undefined || run.startedAt > held.startedAt) newest.set(key, run);
  }
  return [...newest.values()];
};

/** How long a held config answer applies; a person's edit to `CLAUDE.md` shows within it. */
const CONFIG_HOLD_MS = 60_000;

/** The limits `plot-host.sh` applies where the caller names none. */
const RUNS_LIMIT = 10;
const SHA_LIMIT = 20;

/** Where the declared instance and the job a branch builds in are. */
interface Target {
  readonly job: string;
}

/**
 * Reads the CI system whose builds live on a Jenkins instance.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's instance,
 * this vendor's token and this vendor's window, and never sees another CI
 * connector's — the property that makes it a file rather than a `case` in
 * `build-resolve.ts`.
 *
 * IT SHELLS TO `plot-host.sh`, which stays the ONE place that talks to a host
 * CLI. `jen` is not invoked here: the script carries the colour-to-`checks`
 * mapping, the instance refusal and the exit-code contract this layer reads.
 *
 * IT NEEDS AN INSTANCE AND SAYS SO. `plot-host.sh` exits 3 without the
 * `Jenkins instance` key, naming three repairs, and this connector reports
 * that refusal through `lastRefusal()` rather than as an empty answer — a
 * repository whose instance is unset has not been asked, which is not the same
 * as a branch that has never built.
 *
 * `runForSha` ASKS JENKINS' REST API THROUGH `jen api`. `jen build list`
 * answers build history and never a commit — measured 2026-09-10, a build
 * entry carries `id`, `status`, timings and stages, and a search of the whole
 * payload for `sha|commit|revision|scm` matches nothing. Jenkins' own REST API
 * answers it at `actions[].lastBuiltRevision.SHA1`, and `jen api <path>`
 * reaches it with the instance's own auth headers, proxy included.
 *
 * A MACHINE WHERE `jen` CANNOT AUTHENTICATE ANSWERS `unaskable`, which is
 * *this connector cannot be asked* rather than *this branch has never built*.
 *
 * IT INHERITS THE GITHUB ARM'S MATCH RULE rather than inventing one: only the
 * asked-for sha, never another build's. A caller handed the wrong build's
 * answer would be back to the branch-scoped guessing this operation exists to
 * end.
 *
 * GIVEN A CLIENT, `runs`, `runForSha` and `runsForSha` read in-process through
 * `jenkinsReads` and start no `plot-host.sh`. `rerunFailed`, `rerunAll` and
 * `limit` stay on the script, and so does every read where no client is
 * given. A refusal in-process answers `unaskable` with the client's words,
 * and a missing instance answers `failed`, as the script's exit 3 does.
 *
 * @param context - where the scripts and the repository are.
 * @param client - the in-process Jenkins client; given, the three reads go through it.
 * @returns a `BuildPort` backed by this vendor's connector.
 */
export const buildJenkins = (context: ShellContext, client?: JenkinsApi): BuildPort => {
  const reads = buildReads({ context, system: SYSTEM }, { PLOT_CI: SYSTEM });
  const api = client === undefined ? null : jenkinsReads(client);
  let inProcessRefusal: string | null = null;
  let lastWasInProcess = false;
  const held = new Map<string, { at: number; value: string }>();

  /** Reads one `## Plot Config` key through `plot-config.sh`, held for {@link CONFIG_HOLD_MS}. */
  const config = async (key: string): Promise<string> => {
    const seen = held.get(key);
    if (seen !== undefined && Date.now() - seen.at < CONFIG_HOLD_MS) return seen.value;
    const said = await runProcess('bash', [scriptPath(context, 'plot-config.sh'), 'get', key, ''], { cwd: context.repoRoot });
    const value = said.code === 0 ? said.stdout.trim() : '';
    held.set(key, { at: Date.now(), value });
    return value;
  };

  /** The job a branch builds in, with the precedence `plot-host.sh` applies, or why none is named. */
  const targetOf = async (branch: string): Promise<{ ok: true; target: Target } | { ok: false; result: PortResult<never> }> => {
    const instance = (await config('Jenkins instance')) || process.env.JENKINS_INSTANCE || '';
    if (instance === '') {
      inProcessRefusal = 'plot-host: CI is jenkins but no Jenkins instance is configured';
      return { ok: false, result: failed() };
    }
    const slash = instance.indexOf('/');
    let job = slash < 0 ? '' : instance.slice(slash + 1);
    const defaultJob = await config('Default branch job');
    if (defaultJob !== '') {
      const head = await runProcess('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: context.repoRoot });
      if (branch === head.stdout.trim().replace(/^origin\//, '')) job = defaultJob;
    }
    if ((process.env.PLOT_JENKINS_JOB ?? '') !== '') job = process.env.PLOT_JENKINS_JOB as string;
    if (job === '') {
      inProcessRefusal = 'plot-host: the Jenkins instance names no job path; a sha lives in a job\'s builds, so it must be <slug>/<job/path>, not a bare host';
      return { ok: false, result: unaskable(inProcessRefusal) };
    }
    return { ok: true, target: { job } };
  };

  /** Reads one job's builds in-process, mapping a refusal to `unaskable`. */
  const builds = async (branch: string, sha: string, limit: number) => {
    lastWasInProcess = true;
    inProcessRefusal = null;
    const target = await targetOf(branch);
    if (!target.ok) return target.result;
    const read = await (api as ReturnType<typeof jenkinsReads>).builds({ job: target.target.job, branch, sha, limit });
    if (!read.ok) {
      inProcessRefusal = read.said;
      return unaskable<never>(read.said);
    }
    return answered(read.runs);
  };

  /** Runs one script read, after which `lastRefusal` reads the script's refusal again. */
  const scripted = <T>(call: () => Promise<T>): Promise<T> => {
    lastWasInProcess = false;
    return call();
  };

  return {
    system: (): BuildSystem => SYSTEM,

    runs: async (branch, limit): Promise<PortResult<readonly BuildRun[]>> => {
      if (api === null) return scripted(() => reads.runs(branch, limit));
      const read = await builds(branch, '', limit ?? RUNS_LIMIT);
      if (!read.ok) return read;
      return answered(read.value.map((run) => runOf({ ...run, conclusion: run.conclusion ?? run.status })));
    },

    runForSha: async (branch, sha, limit): Promise<PortResult<ShaRun | null>> => {
      let run: PortResult<ShaRun | null>;
      if (api === null) run = await scripted(() => reads.runForSha(branch, sha, limit));
      else {
        const read = await builds(branch, sha, limit ?? SHA_LIMIT);
        run = read.ok ? answered(read.value[0] === undefined ? null : shaRunOf(read.value[0])) : read;
      }
      if (!run.ok) return run;
      return answered(
        run.value === null ? null : { ...run.value, conclusion: jenkinsConclusion(run.value.conclusion) },
      );
    },

    runsForSha: async (branch, sha): Promise<PortResult<readonly WorkflowShaRun[]>> => {
      let listing: PortResult<readonly WorkflowShaRun[]>;
      if (api === null) listing = await scripted(() => reads.runsForSha(branch, sha));
      else {
        const read = await builds(branch, sha, SHA_LIMIT);
        listing = read.ok ? answered(read.value.map(workflowShaRunOf)) : read;
      }
      if (!listing.ok) return listing;
      return answered(
        newestPerSha(listing.value).map((run) => ({
          ...run,
          conclusion: jenkinsConclusion(run.conclusion),
        })),
      );
    },

    // `plot-host.sh rerun-failed` and `rerun-all` exit 4 for Jenkins, which reads `unaskable`.
    rerunFailed: (branch, sha): Promise<PortResult<null>> => scripted(() => reads.rerunFailed(branch, sha)),

    rerunAll: (branch, sha): Promise<PortResult<null>> => scripted(() => reads.rerunAll(branch, sha)),

    limit: (): Promise<PortResult<readonly LimitReading[]>> => scripted(() => reads.limit()),

    lastRefusal: (): string | null => (lastWasInProcess ? inProcessRefusal : reads.lastRefusal()),
  };
};
