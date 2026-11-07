import type { Known, Ref } from '../entities/card-facts.js';
import type { StoryStatus } from '../entities/story.js';

/**
 * What a story's `issue:` value names, read against this repository.
 *
 * - `none`: the story names no issue.
 * - `key`: the issue key the ticket rows use (`3170`, `PROJ-12`).
 * - `unreadable`: a value this repository does not accept; `value` is the
 *   value as written, capped at 120 characters.
 * - `unknown`: the value needs the repository's own address, and the board has
 *   not read it.
 */
export type StoryIssueLink =
  | { kind: 'none' }
  | { kind: 'key'; key: string }
  | { kind: 'unreadable'; value: string }
  | { kind: 'unknown' };

/** What `storyIssueLink` reads the value against. */
export interface StoryIssueContext {
  /**
   * The prefix of this repository's issue pages on its git host
   * (`https://github.com/org/repo/issues/`); `null` where the board has not
   * read the repository's address.
   */
  issuePrefix: string | null;
  /** The Jira project keys `Tracker: jira <url> PROJ, OPS` declares; `[]` where none is declared. */
  jiraProjects: readonly string[];
}

/** The length an unreadable value is capped at. */
const UNREADABLE_MAX = 120;

/** A template placeholder such as `{JIRA_TICKET_URL}`, which reads as no value. */
const PLACEHOLDER = /^\{[A-Z_]+\}$/;

const JIRA_KEY = /^([A-Z][A-Z0-9]+)-(\d+)$/;

/**
 * The value a story names its ticket by: `issue:`, else the legacy `jira:`.
 * A template placeholder reads as absent.
 *
 * @param issue - the frontmatter `issue:` value, unquoted; `''` where absent.
 * @param jira - the frontmatter `jira:` value, unquoted; `''` where absent.
 * @returns the value to read, or `''` where the story names none.
 */
export const storyIssueValue = (issue: string, jira: string): string => {
  const present = (v: string) => (PLACEHOLDER.test(v.trim()) ? '' : v.trim());
  return present(issue) || present(jira);
};

/** A Jira key whose project is declared, else `null`. */
const declaredJiraKey = (candidate: string, projects: readonly string[]): string | null => {
  const match = JIRA_KEY.exec(candidate);
  return match !== null && projects.includes(match[1] as string) ? candidate : null;
};

/**
 * Reads a story's issue value against this repository.
 *
 * Accepts `#<n>` and `<issuePrefix><n>` (this repository's own issue page, the
 * comparison case-insensitive, a trailing title segment, `/` or fragment
 * allowed), and a Jira
 * key, bare or at the end of a `/browse/<KEY>` URL, whose project is declared.
 * Any other value is `unreadable`. A value that needs the repository's address
 * reads `unknown` while that address is unread.
 *
 * @param value - the value from {@link storyIssueValue}.
 * @param context - the repository's issue prefix and the declared Jira projects.
 * @returns what the value names.
 */
export const storyIssueLink = (value: string, context: StoryIssueContext): StoryIssueLink => {
  const v = value.trim();
  if (v === '') return { kind: 'none' };
  const unreadable: StoryIssueLink = { kind: 'unreadable', value: v.slice(0, UNREADABLE_MAX) };

  const jira = declaredJiraKey(v, context.jiraProjects)
    ?? declaredJiraKey(/^https?:\/\/[^\s]+\/browse\/([A-Z][A-Z0-9]+-\d+)\/?$/.exec(v)?.[1] ?? '', context.jiraProjects);
  if (jira !== null) return { kind: 'key', key: jira };

  const short = /^#(\d+)$/.exec(v);
  // A trailing title segment (`/issues/12/the-title`, Bitbucket's form), `/` or fragment is allowed.
  const page = /^(https?:\/\/\S+\/issues\/(\d+))(?:\/[^\s/#]*)?\/?(?:#\S*)?$/.exec(v);
  if (short === null && page === null) return unreadable;
  if (context.issuePrefix === null) return { kind: 'unknown' };
  if (short !== null) return { kind: 'key', key: short[1] as string };
  const [, named, number] = page as RegExpExecArray;
  const own = `${context.issuePrefix}${number}`.toLowerCase();
  return (named as string).toLowerCase() === own ? { kind: 'key', key: number as string } : unreadable;
};

/**
 * The Jira project keys a repository declares: the keys after the URL in
 * `Tracker: jira <url> PROJ, OPS`, and the keys in `Ticket prefixes`, each once.
 * Only a `jira` tracker declares any.
 *
 * @param declaredTracker - the `Tracker` config value, verbatim.
 * @param ticketPrefixes - the `Ticket prefixes` config value, verbatim; `''` where unset.
 * @returns the declared project keys, in order; `[]` for another scheme or none declared.
 */
export const jiraProjectsOf = (declaredTracker: string, ticketPrefixes = ''): string[] => {
  const [scheme = '', , ...rest] = declaredTracker.trim().split(/\s+/);
  if (scheme.toLowerCase() !== 'jira') return [];
  const keys = [...rest.join(' ').split(/[,\s]+/), ...ticketPrefixes.split(/[,\s]+/)];
  return [...new Set(keys.filter((p) => /^[A-Z][A-Z0-9]+$/.test(p)))];
};

/**
 * The prefix of this repository's issue pages, from its branch-page prefix:
 * `https://github.com/o/r/tree/` gives `https://github.com/o/r/issues/`, and
 * `https://bitbucket.org/w/r/branch/` gives `https://bitbucket.org/w/r/issues/`.
 *
 * @param branchUrlBase - the branch-page prefix the board read from `origin`; `''` where unread.
 * @returns the issue-page prefix, or `null` where the branch prefix is unread or of another shape.
 */
export const repoIssuePrefixOf = (branchUrlBase: string): string | null => {
  const repo = /^(https?:\/\/.+\/)(?:tree|branch)\/$/.exec(branchUrlBase)?.[1];
  return repo === undefined ? null : `${repo}issues/`;
};

/** A committed story, as the ticket → story index reads it. */
export interface IndexedStory {
  slug: string;
  title: string;
  /** The story's declared status; `null` where the file states none the domain admits. */
  status: StoryStatus | null;
  archived: boolean;
  /** What the story's `issue:` names. */
  issue: StoryIssueLink;
}

/** A plan, as the ticket → story index reads it. */
export interface IndexedPlan {
  /** The issue keys the plan's `Issue:` field names, without `#`. */
  issues: readonly string[];
  /** The plan's `Story:` slug; `''` where it names none. */
  story: string;
}

/**
 * Which stories answer each ticket: the stories whose `issue:` names it, and
 * the stories named by the `Story:` field of a plan that answers it. A story
 * appears once per ticket, in slug order. A plan naming a story that is not
 * among `stories` links nothing.
 *
 * @param stories - the stories committed on the default branch, archived included.
 * @param plans - the plans the board read.
 * @returns each ticket key with its story refs; a key with no story is absent.
 */
export const ticketStoryIndex = (
  stories: readonly IndexedStory[], plans: readonly IndexedPlan[],
): Map<string, Ref[]> => {
  const bySlug = new Map(stories.map((s) => [s.slug, s]));
  const slugs = new Map<string, Set<string>>();
  const add = (key: string, slug: string) => {
    const set = slugs.get(key) ?? new Set<string>();
    set.add(slug);
    slugs.set(key, set);
  };
  for (const story of stories) if (story.issue.kind === 'key') add(story.issue.key, story.slug);
  for (const plan of plans) {
    if (plan.story === '' || !bySlug.has(plan.story)) continue;
    for (const key of plan.issues) add(key.replace(/^#/, ''), plan.story);
  }
  const index = new Map<string, Ref[]>();
  for (const [key, set] of slugs) {
    index.set(key, [...set].sort().map((slug): Ref => {
      const s = bySlug.get(slug) as IndexedStory;
      return { kind: 'story', slug, title: s.title, status: s.status, archived: s.archived };
    }));
  }
  return index;
};

/** The shape a story slug must have before a request may name it. */
export const STORY_SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Whether a story can receive a new plan: its status is not `done` and it is
 * not archived. A Draft story is live; a story whose status could not be read
 * is not.
 *
 * @param story - the story's status and archived flag.
 * @returns `true` for a live story.
 */
export const storyIsLive = (story: { status: StoryStatus | null; archived: boolean }): boolean =>
  !story.archived && story.status !== null && story.status !== 'done';

/**
 * The stories the index names for one ticket, and whether the ticket may offer
 * *Create story*: only where the index was read and names none.
 *
 * @param index - the ticket → story index, or `unknown` where it was not built.
 * @param key - the ticket's issue key.
 * @returns the ticket's stories as a known list, and whether *Create story* applies.
 */
export const ticketStoryOffer = (
  index: Known<Readonly<Record<string, readonly Ref[]>>>, key: string,
): { stories: Known<Ref[]>; createStory: boolean } => {
  if ('unknown' in index) return { stories: { unknown: index.unknown }, createStory: false };
  const stories = [...(index.value[key] ?? [])];
  return { stories: { value: stories }, createStory: stories.length === 0 };
};
