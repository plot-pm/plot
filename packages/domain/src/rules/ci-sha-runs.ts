/** One run of a CI job, in the shape the sha-bound reads answer. */
export interface CiRun {
  readonly status: 'in_progress' | 'completed';
  /** The system's raw result word, or null while the build runs. */
  readonly conclusion: string | null;
  readonly url: string;
  /** ISO-8601 start in whole seconds, or '' where the build has no timestamp. */
  readonly startedAt: string;
  /** The job path the build belongs to. */
  readonly workflow: string;
  /** The commit the build's own record names, or ''. */
  readonly sha: string;
}

/** What {@link ciRunsOf} filters by. */
export interface CiRunsInput {
  /** The commit asked about, or '' for every build of the branch. */
  readonly sha: string;
  readonly job: string;
  readonly branch: string;
  /** True where the branch's own path did not yield builds, so builds of other branches are in the list. */
  readonly plain: boolean;
  readonly limit: number;
}

interface Record_ {
  readonly sha: unknown;
  readonly branches: readonly string[];
}

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== false;

/** Strips `refs/remotes/` or `refs/heads/`, then `origin/`. */
const branchName = (name: string): string =>
  name.replace(/^(refs\/remotes\/|refs\/heads\/)/, '').replace(/^origin\//, '');

/** The revision records one build carries. */
const recordsOf = (build: unknown): Record_[] => {
  const actions = (build as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  const records: Record_[] = [];
  for (const action of actions) {
    const revision = (action as { lastBuiltRevision?: unknown } | null)?.lastBuiltRevision;
    if (!present(revision) || typeof revision !== 'object') continue;
    const { SHA1, branch } = revision as { SHA1?: unknown; branch?: unknown };
    const names = Array.isArray(branch)
      ? branch.flatMap((one) => {
          const name = (one as { name?: unknown } | null)?.name;
          return typeof name === 'string' ? [branchName(name)] : [];
        })
      : [];
    records.push({ sha: SHA1 ?? null, branches: names });
  }
  return records;
};

/** The commit a build belongs to: the record naming the branch, else the lone unnamed record's. */
const headSha = (records: readonly Record_[], branch: string): string => {
  const named = records.find((one) => one.branches.includes(branch));
  if (named !== undefined && present(named.sha)) return String(named.sha);
  if (records.every((one) => one.branches.length === 0)) {
    const last = records[records.length - 1];
    return last !== undefined && present(last.sha) ? String(last.sha) : '';
  }
  return '';
};

/** `todate` of epoch milliseconds: whole seconds, no fraction. */
const startedAtOf = (timestamp: unknown): string =>
  typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(Math.floor(timestamp / 1000) * 1000).toISOString().replace('.000Z', 'Z')
    : '';

/**
 * Picks the builds that belong to a commit or a branch.
 *
 * A declared duplicate of the jq program in `plot-host.sh`'s `jenkins_sha_runs`,
 * held to it by `corpus/jenkins-reads.corpus.test.ts`. A build belongs to a
 * commit by its own revision record, never by its name. `NOT_BUILT` builds
 * are dropped always, and `ABORTED` ones only where no commit is asked. A
 * commit matches whole, or as a prefix where it is seven or more lower-case
 * hex digits. With no commit, a `plain` listing keeps the builds whose record
 * names the branch. The cut to `limit` comes last, after every filter.
 *
 * @param builds - the `builds` array of the job's answer, newest first.
 * @param input - what to filter by.
 * @returns the runs, newest first, at most `limit`.
 */
export const ciRunsOf = (builds: readonly unknown[], input: CiRunsInput): CiRun[] => {
  const prefixable = /^[0-9a-f]{7,}$/.test(input.sha);
  const rows = builds.map((build) => {
    const one = build as { building?: unknown; result?: unknown; url?: unknown; timestamp?: unknown };
    const records = recordsOf(build);
    const running = present(one.building);
    const run: CiRun = {
      status: running ? 'in_progress' : 'completed',
      conclusion: running ? null : present(one.result) ? String(one.result) : null,
      url: present(one.url) ? String(one.url) : '',
      startedAt: present(one.timestamp) ? startedAtOf(one.timestamp) : '',
      workflow: input.job,
      sha: headSha(records, input.branch),
    };
    return { records, run };
  });
  return rows
    .filter((row) => row.run.conclusion !== 'NOT_BUILT')
    .filter((row) => input.sha !== '' || row.run.conclusion !== 'ABORTED')
    .filter((row) => {
      if (input.sha !== '') return row.run.sha === input.sha || (prefixable && row.run.sha.startsWith(input.sha));
      if (!input.plain) return true;
      return row.records.some((one) => one.branches.includes(input.branch));
    })
    .map((row) => row.run)
    .slice(0, input.limit);
};
