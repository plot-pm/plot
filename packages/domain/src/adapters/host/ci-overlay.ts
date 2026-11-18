import type { PrListingRow } from '../../ports/host.js';
import type { CiBuildMap } from '../../rules/ci-build-map.js';
import { ciBuildFields, type CiBuildArm, type CiBuildReading } from '../../rules/ci-build-rows.js';
import { bindChecks, rowsToBind, SHA_LOOKUPS_PER_PASS, type BoundChecks, type JenkinsShaRun } from '../../rules/jenkins-pr-checks.js';
import type { JenkinsReads } from '../build/jenkins-api.js';

/** Builds a listing read for the commit of one row: how many builds one lookup asks for. */
const SHA_LOOKUP_LIMIT = 20;

/** What the overlay reads from the CI system. */
export interface CiBuildReader {
  /** Reads the branch-colour map, or says why the pass cannot proceed at all. */
  colours(): Promise<{ readonly ok: true; readonly reading: CiBuildMap } | { readonly ok: false; readonly said: string }>;
  /** Reads the builds of `sha` on `branch`, or null where the CI system could not be asked. */
  runs(branch: string, sha: string): Promise<readonly JenkinsShaRun[] | null>;
}

/** What {@link jenkinsBuildReader} resolves the job from. */
export interface JenkinsReaderOptions {
  /** The in-process reads. */
  readonly reads: JenkinsReads;
  /** Reads one `## Plot Config` key, or `''` where it is unset. */
  readonly config: (key: string) => Promise<string>;
  /** The default branch's name as `origin/HEAD` names it, or `''` where it names none. */
  readonly defaultBranch: () => Promise<string>;
  /** The environment; `JENKINS_INSTANCE` and `PLOT_JENKINS_JOB` are read from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

const NO_INSTANCE = 'plot-host: CI is jenkins but no Jenkins instance is configured';

/**
 * Reads the CI system's colours and builds for one listing pass.
 *
 * The job resolves as `plot-host.sh` resolves it. The colour map reads
 * `PLOT_JENKINS_JOB`, else the path after the instance's first `/`, else the
 * root. A commit lookup reads the same path, replaced by `Default branch job`
 * where the branch is the default branch, and then by `PLOT_JENKINS_JOB`. A
 * lookup with no job path answers null, as the shell's exit 4 does.
 *
 * @param options - the reads and where the job is named.
 * @returns the reader.
 */
export const jenkinsBuildReader = (options: JenkinsReaderOptions): CiBuildReader => {
  const instanceOf = async (): Promise<string> => (await options.config('Jenkins instance')) || options.env.JENKINS_INSTANCE || '';
  const jobOf = (instance: string): string => {
    const slash = instance.indexOf('/');
    return slash < 0 ? '' : instance.slice(slash + 1);
  };
  const override = (): string => options.env.PLOT_JENKINS_JOB ?? '';
  return {
    colours: async () => {
      const instance = await instanceOf();
      if (instance === '') return { ok: false, said: NO_INSTANCE };
      return { ok: true, reading: await options.reads.colourMap(override() !== '' ? override() : jobOf(instance)) };
    },
    runs: async (branch, sha) => {
      const instance = await instanceOf();
      if (instance === '') return null;
      let job = jobOf(instance);
      const defaultJob = await options.config('Default branch job');
      if (defaultJob !== '' && branch === (await options.defaultBranch())) job = defaultJob;
      if (override() !== '') job = override();
      if (job === '') return null;
      const read = await options.reads.builds({ job, branch, sha, limit: SHA_LOOKUP_LIMIT });
      return read.ok ? read.runs : null;
    },
  };
};

/** The fields the Jenkins arm of `plot-host.sh pr-list` never emits and the rollup arm does. */
const ROLLUP_ONLY = ['ciChecks', 'plotReview', 'plotReviewSha', 'plotReviewAt'] as const;

/** What {@link overlayCiRows} answers. */
export type CiOverlay =
  | { readonly ok: true; readonly rows: readonly PrListingRow[] }
  | { readonly ok: false; readonly said: string };

/**
 * Overlays the CI system's checks on a listing's rows.
 *
 * The pass reads the colour map once. Rows whose colour cannot settle their
 * head (`rowsToBind`) are read by commit, newest first, at most
 * {@link SHA_LOOKUPS_PER_PASS}, and a lookup that cannot ask ends the pass. Each
 * row then takes `checks`, `checksSha`, `failing_checks` and, where its colour
 * went unbound, `checksLookup` from `ciBuildFields`. The `ciChecks` and
 * `plotReview*` fields leave the row, because the shell's Jenkins arm has none.
 * An open row only is bound on the Bitbucket arm, every row on the GitHub arm.
 *
 * @param rows - the listing's rich rows.
 * @param reader - what to read.
 * @param arm - how a named row whose lookup did not answer reads.
 * @param bound - each branch's `checksSha` as the caller's index holds it.
 * @returns the rows, or why the pass cannot proceed.
 */
export const overlayCiRows = async (
  rows: readonly PrListingRow[],
  reader: CiBuildReader,
  arm: CiBuildArm,
  bound: Readonly<Record<string, string>> | undefined,
): Promise<CiOverlay> => {
  const colours = await reader.colours();
  if (!colours.ok) return colours;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const heads = rows
    .filter((row) => arm === 'colour-stands' || row.state === 'OPEN')
    .map((row) => ({ headRefName: text(row.head), headRefOid: text(row.headSha), updatedAt: text(row.updatedAt) }));
  const wanted = colours.reading.status === 'ok' ? rowsToBind(heads, colours.reading.map, SHA_LOOKUPS_PER_PASS, bound ?? {}) : [];
  const answers: Record<string, BoundChecks> = {};
  for (const each of wanted) {
    const runs = await reader.runs(each.branch, each.sha);
    if (runs === null) break;
    const checked = bindChecks(runs, each.job, each.sha);
    if (checked !== null) answers[each.branch] = checked;
  }
  const reading: CiBuildReading = {
    status: colours.reading.status,
    map: colours.reading.map,
    bound: Object.keys(answers).length === 0 ? null : answers,
    named: wanted.map((each) => each.branch),
  };
  return {
    ok: true,
    rows: rows.map((row) => {
      const kept = Object.fromEntries(Object.entries(row).filter(([name]) => !(ROLLUP_ONLY as readonly string[]).includes(name)));
      return { ...kept, ...ciBuildFields({ head: text(row.head), headSha: text(row.headSha), open: row.state === 'OPEN' }, reading, arm) };
    }),
  };
};
