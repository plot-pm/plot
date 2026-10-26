import type { TicketSource } from './ownership.js';

/** A tracker scheme some connector can list open issues from. */
export interface IssueLister {
  /** The scheme, lowercased, as the `Tracker` key's first word names it. */
  readonly scheme: string;
  /** The one git host this scheme lists from, where it lists from only one. */
  readonly onlyOnHost?: string;
  /** How this scheme's issues name their assignees; absent where they cannot be matched to a reader. */
  readonly assignees?: TicketSource;
}

/** A git host whose own issue list names assignees, and how it names them. */
export interface HostIssueLister {
  /** The git host's backend word, as `plot-host.sh backend` reports it. */
  readonly backend: string;
  /** How this host's issues name their assignees. */
  readonly assignees: TicketSource;
}

/** What a repository says about where its issues live, and what can list them. */
export interface IssueSourceReading {
  /** The `Tracker` config key's value, verbatim; `''` where the repository declared none. */
  readonly declared: string;
  /** The git host's backend word, as `plot-host.sh backend` reports it. */
  readonly gitHost: string;
  /** The schemes a connector lists issues from, as the adapters declare them. */
  readonly listers: readonly IssueLister[];
}

/**
 * Who answers the open-issue list.
 *
 * `tracker` is a declared tracker whose connector lists issues; `git-host` is a
 * repository that declared no tracker, whose git host lists its own issues;
 * `nobody` is a declared tracker that no connector lists here, and carries the
 * sentence that says why.
 */
export type IssueSource =
  | { readonly ask: 'tracker'; readonly scheme: string }
  | { readonly ask: 'git-host' }
  | { readonly ask: 'nobody'; readonly reason: string };

/** The prefix `plot-host.sh` puts on every sentence it writes to stderr. */
const SCRIPT_PREFIX = /^plot-host:\s*/;

/** The `Tracker` scheme that means "no external tracker", same as an empty declaration. */
const NO_EXTERNAL_TRACKER = 'plot';

/**
 * The `Tracker` config key's scheme: its first word, lowercased; `''` where
 * `declared` names none.
 *
 * @param declared - the `Tracker` config key's value, verbatim.
 * @returns the scheme, lowercased.
 */
const trackerScheme = (declared: string): string =>
  // The first word, as one string: `split` with a limit of 1 joins to it.
  declared.trim().split(/\s+/, 1).join('').toLowerCase();

/**
 * Decides who answers a repository's open-issue list.
 *
 * A declared tracker is never answered by the git host in its place: a list
 * from the wrong service is wrong about every row. A repository that declared
 * no tracker, or declared {@link NO_EXTERNAL_TRACKER}, asks its git host.
 *
 * @param reading - the declared `Tracker` value, the git host's backend, and
 *   the schemes a connector lists.
 * @returns the source to ask, or `nobody` with the reason no list exists.
 */
export const issueSource = (reading: IssueSourceReading): IssueSource => {
  const scheme = trackerScheme(reading.declared);
  if (scheme === '' || scheme === NO_EXTERNAL_TRACKER) return { ask: 'git-host' };
  const lister = reading.listers.find((l) => l.scheme === scheme);
  if (lister === undefined) {
    return {
      ask: 'nobody',
      reason:
        `no connector lists issues from the declared tracker \`${scheme}\`, ` +
        'and the git host is not asked in its place',
    };
  }
  if (lister.onlyOnHost !== undefined && lister.onlyOnHost !== reading.gitHost) {
    return {
      ask: 'nobody',
      reason:
        `the declared tracker \`${scheme}\` lists issues only where the git host is ` +
        `\`${lister.onlyOnHost}\`, and this repository's git host is \`${reading.gitHost}\``,
    };
  }
  return { ask: 'tracker', scheme };
};

/**
 * The sentence a board shows where the open-issue list cannot be asked.
 *
 * @param reason - why no list exists: an {@link issueSource} reason, or the
 *   sentence `plot-host.sh` wrote with exit 4. A leading `plot-host:` is dropped.
 * @returns one sentence naming the absence and its reason.
 */
export const issueAbsence = (reason: string): string => {
  const why = reason.trim().replace(SCRIPT_PREFIX, '');
  return why === ''
    ? 'Open issues are not listed: this host has no issue tracker.'
    : `Open issues are not listed: ${why}`;
};

/**
 * Who owns a repository's sprints: plot itself, or an external tracker plot
 * defers to.
 *
 * `plot` means `/plot-sprint` operates; `external` carries the tracker's
 * scheme so the decline sentence can name it.
 */
export type SprintOwner =
  | { readonly owns: 'plot' }
  | { readonly owns: 'external'; readonly scheme: string };

/**
 * Decides who owns a repository's sprints.
 *
 * `Sprint owner` and `Tracker` answer independent questions — this repo's
 * sprints versus where its issues live — and a repository that sets neither,
 * or sets only `Tracker`, keeps today's rule unchanged: a declared external
 * tracker's own sprint board and a plot-kept one would update independently of
 * each other and drift apart, so plot declines to keep the second one unless
 * `Sprint owner: plot` says otherwise. `Sprint owner` exists only to let a
 * repository say "plot" to the first question while still naming an external
 * tracker for the second — declaring `Sprint owner` with any other value, or
 * declaring `Sprint owner: plot` with no `Tracker`, decides nothing a bare
 * `Tracker` reading didn't already decide, so the key is read only where it
 * is present and non-empty.
 *
 * @param declaredSprintOwner - the `Sprint owner` config key's value,
 *   verbatim; `''` where the repository declared none.
 * @param declaredTracker - the `Tracker` config key's value, verbatim; `''`
 *   where the repository declared none.
 * @returns `plot` where `/plot-sprint` operates, or `external` with the
 *   tracker's scheme where it declines.
 */
export const sprintOwner = (declaredSprintOwner: string, declaredTracker: string): SprintOwner => {
  const owner = declaredSprintOwner.trim().toLowerCase();
  if (owner === NO_EXTERNAL_TRACKER) return { owns: 'plot' };
  const scheme = trackerScheme(declaredTracker);
  return scheme === '' || scheme === NO_EXTERNAL_TRACKER ? { owns: 'plot' } : { owns: 'external', scheme };
};

/**
 * The stderr sentence for a Bitbucket `bb` with no issue command.
 *
 * An empty `declared` (no `Tracker` key) is told to declare one. A `declared`
 * of `plot` — the same value {@link issueSource} reads as "ask the git host"
 * — is told the working pair instead: `Tracker: <suggested> <base URL>` keeps
 * the issue list readable, and `Sprint owner: plot` keeps `/plot-sprint`
 * operating without that pair handing sprints to the newly-declared tracker.
 * With no `suggested` scheme, it is told to declare one, as an empty
 * `declared` is.
 * A `declared` naming an external tracker already made that declaration, so
 * neither remedy is added.
 *
 * Starts with "lists", not "bb lists": the caller already wrote `bb
 * ${version}` ahead of this sentence, so a leading "bb" here would repeat it.
 *
 * @param declared - the `Tracker` key's value, verbatim; `''` where none is declared.
 * @param suggested - the tracker scheme the pair names, chosen by the caller from the
 *   connectors it ships; `''` where it suggests none.
 * @returns the sentence `plot-host.sh` appends after `bb ${version}` on stderr before exiting 4.
 */
export const bbIssueCommandMissing = (declared: string, suggested: string): string => {
  const base = 'lists no issue command — Quatico bb has none, unlike craftamap/bb — ' +
    "so this repository's issues cannot be read through it";
  const trimmed = declared.trim();
  const declareOne = `${base}; declare the issue tracker with the \`Tracker\` config key`;
  if (trimmed === '') return declareOne;
  const scheme = trackerScheme(declared);
  if (scheme !== NO_EXTERNAL_TRACKER) return base;
  return suggested === ''
    ? declareOne
    : `${base}; declare \`Tracker: ${suggested} <base URL>\` with \`Sprint owner: plot\``;
};
