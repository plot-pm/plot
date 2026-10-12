import { statusStateOf } from './state-transition.js';

/** The phases a plan can be read as, the words `plot-plan-meta.sh` normalises to. */
export type PlanPhase = 'draft' | 'design' | 'approved' | 'delivered' | 'released' | 'rejected' | 'superseded';

const KNOWN_PHASES: readonly PlanPhase[] = ['draft', 'design', 'approved', 'delivered', 'released', 'rejected', 'superseded'];

/**
 * The first known phase word in a field's value. A value such as
 * `Approved — 2026-10-10` or `**Draft**` reads by its first known token, and
 * `ready-for-review` and `in-review` read as `approved`.
 *
 * @param raw - the field value as written.
 * @returns the phase, or `null` where the value holds no known word.
 */
export const phaseWordOf = (raw: string): PlanPhase | null => {
  for (const token of raw.toLowerCase().split(/[ \t]+/)) {
    const word = token.replace(/^[^a-z]+/, '').replace(/[^a-z-]+$/, '');
    if ((KNOWN_PHASES as readonly string[]).includes(word)) return word as PlanPhase;
    if (word === 'ready-for-review' || word === 'in-review') return 'approved';
  }
  return null;
};

/**
 * The value of a `status:` or `phase:` key in a leading `---` front-matter
 * block; `status:` wins, and the first occurrence of each key wins.
 */
const frontMatterPhaseOf = (text: string): string => {
  if (!/^---[ \t]*(\n|$)/.test(text)) return '';
  let status = '';
  let phase = '';
  for (const line of text.split('\n').slice(1)) {
    if (/^---[ \t]*$/.test(line)) break;
    const value = (): string => line.replace(/^[^:]*:/, '').replace(/^\**[ \t]*/, '').replace(/^"|"$/g, '').trim();
    if (/^status:/i.test(line) && status === '') status = value();
    else if (/^phase:/i.test(line) && phase === '') phase = value();
  }
  return status !== '' ? status : phase;
};

/**
 * A plan's phase, read from its text: the `State:` or `Phase:` line in `## Status`
 * first, then front matter. The same order as `plot-plan-meta.sh`, without that
 * script's fence and comment handling.
 *
 * @param text - the plan file's content.
 * @returns the phase, or `null` where the text names none.
 */
export const planPhaseOf = (text: string): PlanPhase | null => {
  const canonical = phaseWordOf(statusStateOf(text));
  return canonical ?? phaseWordOf(frontMatterPhaseOf(text));
};

/**
 * The branch prefixes that carry implementation: the `Branch prefixes` config
 * value without its `/` and without `idea`, whose branches carry the plan
 * itself. Falls back to `feature`, `bug`, `docs` and `infra` where none remain.
 *
 * @param raw - the config value, such as `idea/, feature/, bug/`.
 */
export const implementationPrefixesOf = (raw: string): readonly string[] => {
  const prefixes = raw
    .split(',')
    .map((entry) => entry.replace(/\s+/g, '').replace(/\/$/, ''))
    .filter((entry) => entry !== '' && entry !== 'idea');
  return prefixes.length > 0 ? prefixes : ['feature', 'bug', 'docs', 'infra'];
};

/**
 * The slug of an implementation branch: what follows its first `/`.
 *
 * @param branch - the current branch name.
 * @param prefixes - from {@link implementationPrefixesOf}.
 * @returns the slug, or `null` for a branch under no implementation prefix.
 */
export const slugOfBranch = (branch: string, prefixes: readonly string[]): string | null =>
  prefixes.some((prefix) => branch.startsWith(`${prefix}/`)) ? branch.slice(branch.indexOf('/') + 1) : null;

/**
 * Whether a basename is `YYYY-MM-DD-<slug>.md`. The date prefix is cut and the
 * remainder compared by equality, so a slug holding a regex character, or one
 * that is a prefix of a longer slug, matches only itself.
 */
export const isPlanFileFor = (basename: string, slug: string): boolean =>
  /^\d{4}-\d{2}-\d{2}-/.test(basename) && basename.slice('YYYY-MM-DD-'.length) === `${slug}.md`;

/**
 * The first path in a listing that is the plan for a slug.
 *
 * @param paths - repository-relative paths, in listing order.
 * @param planDir - the `Plan directory` config value; a path matches by directory and basename.
 * @param slug - the branch's slug.
 */
export const planPathFor = (paths: readonly string[], planDir: string, slug: string): string | null => {
  const dir = planDir.replace(/\/+$/, '');
  for (const path of paths) {
    const at = path.lastIndexOf('/');
    if (path.slice(0, at) === dir && isPlanFileFor(path.slice(at + 1), slug)) return path;
  }
  return null;
};

/** Where the review artifacts live: the places a commit may edit while a plan is under review. */
export interface ReviewHomes {
  /** The `Plan directory` config value. */
  planDir: string;
  /** The `Story directory` config value. */
  storyDir: string;
}

/**
 * Whether a path is outside the review artifacts: not under the plan
 * directory, the story directory, `.plot/`, or any directory sharing the story
 * directory's basename (a sub-unit home such as `clients/acme/stories/`).
 */
export const outsideReviewArtifacts = (path: string, { planDir, storyDir }: ReviewHomes): boolean => {
  const plans = planDir.replace(/\/+$/, '');
  const stories = storyDir.replace(/\/+$/, '');
  const base = stories.slice(stories.lastIndexOf('/') + 1);
  if (path.startsWith(`${plans}/`) || path.startsWith(`${stories}/`) || path.startsWith('.plot/')) return false;
  return !path.includes(`/${base}/`);
};

/**
 * Whether a path is outside the plan directory. The phase check's carve-out:
 * under a Draft or Design plan only the plan directory passes, while the hold
 * check also passes story and `.plot/` paths ({@link outsideReviewArtifacts}).
 */
export const outsidePlanDir = (path: string, planDir: string): boolean =>
  !path.startsWith(`${planDir.replace(/\/+$/, '')}/`);

/** What the hold check reads. */
export interface HoldReadings extends ReviewHomes {
  /** The current branch. */
  branch: string;
  /** The content of `.plot/hold`, or `null` where there is none. */
  hold: string | null;
  /** The repository-relative paths the commit carries. */
  paths: readonly string[];
}

/**
 * The refusal for a branch under an explicit review hold, or `null`. A hold is
 * a line `<branch> <free-text reason>`; the first field is compared to the
 * branch by string equality, never as a pattern. A commit carrying only plan,
 * story or `.plot/` paths passes.
 */
export const holdRefusal = ({ branch, hold, paths, ...homes }: HoldReadings): string | null => {
  if (hold === null) return null;
  const line = hold
    .split('\n')
    .map((entry) => entry.trimStart())
    .find((entry) => entry.split(/[ \t]+/)[0] === branch);
  if (line === undefined || !paths.some((path) => outsideReviewArtifacts(path, homes))) return null;
  const reason = line.slice(branch.length);
  return [
    `plot phase gate: branch '${branch}' is under an explicit review hold (.plot/hold):${reason === '' ? ' no reason recorded' : reason}`,
    'Finish the review and record the approval (which removes the hold), or stage only plan/story files.',
  ].join('\n');
};

/** What the phase check reads once it holds the plan's phase. */
export interface PhaseReadings {
  /** The `Plan directory` config value. */
  planDir: string;
  /** The current branch. */
  branch: string;
  /** The branch's slug. */
  slug: string;
  /** The shared ref the plan was read from, such as `origin/main`. */
  ref: string;
  /** The plan's phase, or `null` where it could not be read. */
  phase: PlanPhase | null;
  /** The repository-relative paths the commit carries. */
  paths: readonly string[];
  /**
   * The plan's spike branch where its `Spike approved:` record is present, else `''`.
   *
   * Absent reads as `''`: a caller that did not read the record admits nothing.
   */
  spikeBranch?: string;
}

/**
 * The refusal for an implementation commit while its plan is still Draft or
 * Design on the shared ref, or `null`. The refusal names the phase as read.
 * A commit carrying only paths under the plan directory passes, as does an
 * unreadable phase: the gate refuses only on a phase it read. A commit on the
 * approved spike branch of a `design` plan passes; every other branch of that
 * plan still refuses.
 */
export const phaseGateRefusal = ({
  branch, slug, ref, phase, paths, planDir, spikeBranch = '',
}: PhaseReadings): string | null => {
  if (phase !== 'draft' && phase !== 'design') return null;
  if (phase === 'design' && spikeBranch !== '' && branch === spikeBranch) return null;
  if (!paths.some((path) => outsidePlanDir(path, planDir))) return null;
  const title = `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
  return [
    `plot phase gate: branch '${branch}' implements plan '${slug}', which is still ${title} on ${ref}.`,
    `The plan is still ${title} — implementation only ever references an approved plan (Manifesto P2).`,
    `Either: review and approve it (/plot-approve ${slug}), or — if this commit only refines the plan — stage only the plan file.`,
  ].join('\n');
};

/** The line printed when the plan is on neither shared ref but a local copy exists. */
export const unpushedPlanNote = (slug: string, ref: string, branch: string): string =>
  [
    `plot-phase-gate: plan '${slug}' is not on ${ref} or origin/${branch} —`,
    '                 phase unverified, allowing the commit. Push the plan to gate on it.',
  ].join('\n');

/** The line printed when the main ref cannot be read. */
export const unreadableRefNote = (ref: string): string =>
  [
    `plot-phase-gate: cannot read ${ref} — phase unverified,`,
    '                 allowing the commit. Run `git fetch` to restore the gate.',
  ].join('\n');
