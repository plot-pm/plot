import type { BuildRun, ShaRun, WorkflowShaRun } from '../../entities/build.js';
import type { LimitReading } from '../../entities/limit.js';
import { answered, unaskable, type PortResult } from '../../port-result.js';
import type { BuildPort, BuildSystem } from '../../ports/build.js';
import type { HostRefusal } from '../../ports/host.js';
import { runsForShaOf } from '../../rules/runs-for-sha.js';
import type { GithubApi } from '../host/github-api.js';
import { githubRuns, type GithubRuns } from '../host/github-runs.js';
import type { ShellContext } from '../scripts.js';
import { buildReads, workflowShaRunOf } from './build-shell.js';

/** The system word `plot-host.sh` knows this connector by, and tags its limit with. */
const SYSTEM = 'github-actions';

/** A GitHub Actions build port, with the whole refusal of its last in-process read. */
export interface GithubActionsBuild extends BuildPort {
  /** The kind, wait and message of the last in-process `runsForSha` refusal; null after an answer, and always null on the shell route. */
  lastHostRefusal(): HostRefusal | null;
}

/**
 * Reads the CI system whose runs live with GitHub Actions.
 *
 * A CONNECTOR, not an adapter with a branch. It holds this vendor's account,
 * this vendor's token and this vendor's window, and it never sees another CI
 * connector's — which is why it is a file rather than a `case`.
 *
 * IT SHELLS TO `plot-host.sh`, which stays the ONE place that talks to a host
 * CLI. `gh` is not invoked here: the script already carries the exit-code
 * contract this layer reads, and a connector calling the CLI directly would be
 * a second implementation of the mapping the script exists to hold.
 *
 * THE GATE IT INHERITED IS FIXED, AND ONE HALF OF IT REMAINS BY DESIGN.
 * `plot-host.sh`'s `runs` and `run-for-sha` arms gated on the GIT HOST rather
 * than the CI system until 2026-09-08, so on a repository whose code is not on
 * GitHub they printed nothing and this connector answered an empty list. They
 * now dispatch on the `CI` key this connector passes in `PLOT_CI`.
 *
 * A GITHUB REMOTE IS STILL REQUIRED, and that is a second condition rather
 * than the old one surviving: `gh run list` reads the runs of the repository
 * its remote names, so `CI: github-actions` on a Bitbucket remote names runs
 * nothing can reach. The script exits 4 there and this connector answers
 * `unaskable` — which is the true word, where the empty list was not.
 *
 * GIVEN A CLIENT, `runsForSha` asks GitHub's API in this process instead of
 * `plot-host.sh runs-for-sha`, with the requests `gh run list` sends, and
 * picks the commit's runs with `runsForShaOf`. A refused request answers
 * `unaskable` with GitHub's message, the answer the script gives for a
 * failing `gh`, and records the whole refusal for `lastHostRefusal`. Every
 * other operation keeps the script.
 *
 * A declared `<workflow>/<job>` name makes `runsForSha` read that run's jobs
 * (one `GET /actions/runs/{id}/jobs` per run a declared name points into) and
 * add an entry per matching job. The entry carries the job's status,
 * conclusion and end, and its run's start (the job's own start where the run
 * reports none), so a duration measured over it covers the whole run and not
 * only a job that waits on the others. The shell route reads no jobs, so a job
 * name has no entry there and folds as `unknown`.
 *
 * @param context - where the scripts and the repository are.
 * @param api - the in-process GitHub client; absent, every read runs the script.
 * @returns a `BuildPort` backed by this vendor's connector.
 */
export const buildActions = (context: ShellContext, api?: GithubApi): GithubActionsBuild => {
  const reads = buildReads({ context, system: SYSTEM }, { PLOT_CI: SYSTEM });
  const runs = api === undefined ? null : githubRuns(api);
  let hostRefusal: HostRefusal | null = null;
  let inProcessRefusal: string | null = null;
  let lastWasInProcess = false;

  const runsForShaInProcess = async (
    branch: string,
    sha: string,
    declared: readonly string[],
  ): Promise<PortResult<readonly WorkflowShaRun[]>> => {
    lastWasInProcess = true;
    const asked = await (runs as GithubRuns).list(branch);
    if (!asked.ok) {
      hostRefusal = asked.refusal;
      inProcessRefusal = asked.refusal.said;
      return unaskable(asked.refusal.said);
    }
    const rows = runsForShaOf(asked.runs, sha).map(workflowShaRunOf);
    const jobRows: WorkflowShaRun[] = [];
    for (const run of asked.runs.filter((one) => one.headSha === sha)) {
      const flow = run.workflowName ?? '';
      if (flow === '' || run.databaseId === undefined) continue;
      const wanted = declared.filter((name) => name.startsWith(`${flow}/`) && !rows.some((row) => row.workflow === name));
      if (wanted.length === 0) continue;
      const jobs = await (runs as GithubRuns).jobs(run.databaseId);
      if (!jobs.ok) {
        hostRefusal = jobs.refusal;
        inProcessRefusal = jobs.refusal.said;
        return unaskable(jobs.refusal.said);
      }
      for (const name of wanted) {
        const job = jobs.jobs.find((one) => `${flow}/${one.name}` === name);
        if (job === undefined) continue;
        jobRows.push({
          sha,
          workflow: name,
          status: job.status,
          conclusion: job.conclusion,
          url: job.url,
          startedAt: Date.parse(run.startedAt) > 0 ? run.startedAt : job.startedAt,
          ...(job.completedAt === '' ? {} : { completedAt: job.completedAt }),
        });
      }
    }
    hostRefusal = null;
    inProcessRefusal = null;
    return answered([...rows, ...jobRows]);
  };

  /** Runs one script read, after which `lastRefusal` reads the script's refusal again. */
  const scripted = <T>(call: () => Promise<T>): Promise<T> => {
    lastWasInProcess = false;
    return call();
  };

  return {
    system: (): BuildSystem => SYSTEM,

    runs: (branch, limit): Promise<PortResult<readonly BuildRun[]>> => scripted(() => reads.runs(branch, limit)),

    runForSha: (branch, sha, limit): Promise<PortResult<ShaRun | null>> =>
      scripted(() => reads.runForSha(branch, sha, limit)),

    runsForSha: (branch, sha, declared = []): Promise<PortResult<readonly WorkflowShaRun[]>> =>
      runs === null ? scripted(() => reads.runsForSha(branch, sha)) : runsForShaInProcess(branch, sha, declared),

    rerunFailed: (branch, sha): Promise<PortResult<null>> => scripted(() => reads.rerunFailed(branch, sha)),

    rerunAll: (branch, sha): Promise<PortResult<null>> => scripted(() => reads.rerunAll(branch, sha)),

    limit: (): Promise<PortResult<readonly LimitReading[]>> => scripted(() => reads.limit()),

    lastRefusal: (): string | null => (lastWasInProcess ? inProcessRefusal : reads.lastRefusal()),

    lastHostRefusal: (): HostRefusal | null => hostRefusal,
  };
};
