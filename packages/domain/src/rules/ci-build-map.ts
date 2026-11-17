/** The `checks` word a PR row carries. */
export type CiChecks = 'green' | 'failing' | 'pending' | 'none';

/** One branch's entry in a CI build map. */
export interface CiMapEntry {
  /** The colour the CI system reports, or null where it reports none. */
  readonly color: string | null;
  /** The `checks` word the colour settles. */
  readonly checks: CiChecks;
  /** The job that builds the branch: `<job>/<branch>`, or the branch alone for a root listing. */
  readonly job: string;
}

/** The answer of a build-map read. `unknown` is a shape nobody measured; `failed` is no answer. */
export interface CiBuildMap {
  readonly status: 'ok' | 'failed' | 'unknown';
  readonly map: Readonly<Record<string, CiMapEntry>>;
}

/** What a job's own `_class` says about how to read it. */
export type CiJobShape = 'plain' | 'multibranch' | 'unreadable' | 'other';

const PLAIN_SUFFIX = '.WorkflowJob';
const MULTIBRANCH_SUFFIX = '.WorkflowMultiBranchProject';

/**
 * Maps a CI colour onto a PR row's `checks` word.
 *
 * A declared duplicate of `JEN_COLOUR_JQ` in `plot-host.sh`, held to it by
 * `corpus/jenkins-reads.corpus.test.ts`. `blue` is green; `red` and `yellow`
 * (tests failed) are failing; any `*_anime` colour is pending, because a
 * build runs; null, empty, `disabled` and any other word are none.
 *
 * @param color - the colour word.
 * @returns the `checks` word.
 */
export const checksOfColour = (color: unknown): CiChecks => {
  if (typeof color !== 'string' || color === '') return 'none';
  if (color.endsWith('_anime')) return 'pending';
  if (color === 'blue') return 'green';
  if (color === 'red' || color === 'yellow') return 'failing';
  return 'none';
};

/**
 * Decodes `%XX` escapes one code unit at a time.
 *
 * A declared duplicate of the `urldecode` in `jenkins_build_map`: each escape
 * becomes the one code point of its hex value, so `%2F` is `/` and a
 * multi-byte sequence is not reassembled into one character.
 *
 * @param text - an encoded name.
 * @returns the decoded name.
 */
export const decodeEscapes = (text: string): string =>
  text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/**
 * Reads how a job's own answer says it is built.
 *
 * A `.WorkflowJob` suffix is a plain job and a `.WorkflowMultiBranchProject`
 * suffix a multibranch one. An answer with no object, or no `_class`, is
 * unreadable and falls through to the listing, as it does in the shell. Any
 * other class is a shape nobody measured.
 *
 * @param view - the parsed answer for the job itself.
 * @returns the shape.
 */
export const shapeOfJob = (view: unknown): CiJobShape => {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return 'unreadable';
  const cls = (view as { _class?: unknown })._class;
  if (typeof cls !== 'string' || cls === '') return 'unreadable';
  if (cls.endsWith(PLAIN_SUFFIX)) return 'plain';
  if (cls.endsWith(MULTIBRANCH_SUFFIX)) return 'multibranch';
  return 'other';
};

/**
 * Builds the map of a plain job.
 *
 * A plain job builds one thing and names no branch, so its one entry is keyed
 * by the last segment of the job path, which is the name the instance
 * declares.
 *
 * @param view - the job's own answer, carrying `color`.
 * @param job - the job path.
 * @returns the one-entry map.
 */
export const plainBuildMap = (view: unknown, job: string): CiBuildMap => {
  const color = (view as { color?: unknown }).color;
  const name = job.slice(job.lastIndexOf('/') + 1);
  return {
    status: 'ok',
    map: { [name]: { color: typeof color === 'string' ? color : null, checks: checksOfColour(color), job } },
  };
};

/**
 * Builds the map of a listing of branch jobs.
 *
 * Each child's percent-encoded name is decoded to the branch it names, so a
 * branch holding `/` is found by its own name.
 *
 * @param jobs - the parsed listing.
 * @param job - the job path the listing is under; '' for the root.
 * @returns the map, or `failed` where the listing is not an array.
 */
export const listingBuildMap = (jobs: unknown, job: string): CiBuildMap => {
  if (!Array.isArray(jobs)) return { status: 'failed', map: {} };
  const entries: [string, CiMapEntry][] = [];
  for (const child of jobs) {
    if (typeof child !== 'object' || child === null) return { status: 'failed', map: {} };
    const { name, color } = child as { name?: unknown; color?: unknown };
    if (typeof name !== 'string') return { status: 'failed', map: {} };
    const branch = decodeEscapes(name);
    entries.push([
      branch,
      {
        color: typeof color === 'string' ? color : null,
        checks: checksOfColour(color),
        job: job === '' ? branch : `${job}/${branch}`,
      },
    ]);
  }
  return { status: 'ok', map: Object.fromEntries(entries) };
};
