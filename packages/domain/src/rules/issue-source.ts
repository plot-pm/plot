/** A tracker scheme some connector can list open issues from. */
export interface IssueLister {
  /** The scheme, lowercased, as the `Tracker` key's first word names it. */
  readonly scheme: string;
  /** The one git host this scheme lists from, where it lists from only one. */
  readonly onlyOnHost?: string;
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

/**
 * Decides who answers a repository's open-issue list.
 *
 * A declared tracker is never answered by the git host in its place: a list
 * from the wrong service is wrong about every row. Only a repository that
 * declared no tracker asks its git host.
 *
 * @param reading - the declared `Tracker` value, the git host's backend, and
 *   the schemes a connector lists.
 * @returns the source to ask, or `nobody` with the reason no list exists.
 */
export const issueSource = (reading: IssueSourceReading): IssueSource => {
  const scheme = (reading.declared.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (scheme === '') return { ask: 'git-host' };
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
