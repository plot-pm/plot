/**
 * The account a budget line is keyed by, as `plot-host.sh`'s `budget_account`
 * names it. `corpus/spend-rate.corpus.test.ts` holds the two to agreement.
 */

/** The word an account takes where nothing names one. */
export const UNKNOWN_BUDGET_ACCOUNT = 'unknown';

/** What {@link budgetAccountOf} reads, each already read by an adapter. */
export interface BudgetAccountReadings {
  /** `PLOT_BUDGET_ACCOUNT`, or undefined where it is not set. */
  readonly override: string | undefined;
  /** The text of `gh`'s `hosts.yml`, or null where it cannot be read. */
  readonly hostsYml: string | null;
  /** `remote.origin.url` from git config, or null where none is set. */
  readonly originUrl: string | null;
  /** The SHA-256 hex digest of `JIRA_EMAIL`, or null where it is empty. */
  readonly jiraEmailSha256: string | null;
}

/**
 * The value of the first indented `user:` key in `gh`'s `hosts.yml`.
 *
 * @param text - the file's text.
 * @returns the second whitespace-separated field of the first line that
 *   starts with whitespace and `user:`; `''` where that line has no second
 *   field; null where no line matches.
 */
export const hostsYmlUser = (text: string): string | null => {
  const line = text.split('\n').find((one) => /^\s+user:/.test(one));
  return line === undefined ? null : (line.trim().split(/\s+/)[1] ?? '');
};

/**
 * The owner segment of a remote URL: the path segment before the last one.
 *
 * @param url - the remote URL.
 * @returns the owner, or the URL unchanged where it has no `owner/name` tail.
 */
export const originOwner = (url: string): string => {
  const match = /^.*[:/]([^/]+)\/[^/]+(\.git)?$/.exec(url);
  return match === null ? url : (match[1] ?? url);
};

/**
 * Names the account one connector's budget lines are keyed by.
 *
 * `jira` reads `jira:` and the first 12 hex digits of the email's digest.
 * Every other connector reads `PLOT_BUDGET_ACCOUNT` first; then `github` reads
 * `hosts.yml`'s user and `bitbucket` the remote's owner.
 *
 * @param connector - the connector's own name.
 * @param readings - what the adapter read.
 * @returns the account, or {@link UNKNOWN_BUDGET_ACCOUNT} where nothing names one.
 */
export const budgetAccountOf = (connector: string, readings: BudgetAccountReadings): string => {
  if (connector === 'jira') {
    return readings.jiraEmailSha256 === null ? UNKNOWN_BUDGET_ACCOUNT : `jira:${readings.jiraEmailSha256.slice(0, 12)}`;
  }
  if (readings.override !== undefined && readings.override !== '') return readings.override;
  const who =
    connector === 'github'
      ? readings.hostsYml === null
        ? null
        : hostsYmlUser(readings.hostsYml)
      : connector === 'bitbucket' && readings.originUrl !== null
        ? originOwner(readings.originUrl)
        : null;
  return who === null || who === '' ? UNKNOWN_BUDGET_ACCOUNT : who;
};
