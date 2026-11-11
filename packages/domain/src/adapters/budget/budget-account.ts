import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runProcess } from '../run-script.js';

// THE ACCOUNT A BUDGET LINE IS KEYED BY, as `plot-host.sh`'s `budget_account`
// names it. It names connectors, so it lives in the adapter.
// `corpus/spend-rate.corpus.test.ts` holds the two to agreement.

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

/** The seams the account reader needs. */
export interface BudgetAccountOptions {
  /** The repository whose `origin` names a Bitbucket owner; the working directory where absent. */
  readonly repoRoot?: string;
  /** The environment the connector runs in; `process.env` where absent. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The text of a file, or null where it cannot be read. */
const textOf = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Reads the account a connector's budget lines are keyed by, in process.
 *
 * Reads `PLOT_BUDGET_ACCOUNT` and `JIRA_EMAIL` from the environment and `gh`'s
 * `hosts.yml` from `$GH_CONFIG_DIR` or `$HOME/.config/gh`. Starts one
 * `git config --get remote.origin.url` for `bitbucket` only, where no override
 * is set. Starts nothing for `github` and `jira`.
 *
 * @param options - the repository and the environment.
 * @returns a reader that answers the account for one connector.
 */
export const budgetAccount = (options: BudgetAccountOptions = {}): ((connector: string) => Promise<string>) => async (connector) => {
  const env = { ...process.env, ...options.env };
  const override = env['PLOT_BUDGET_ACCOUNT'];
  const email = env['JIRA_EMAIL'] ?? '';
  const configDir = env['GH_CONFIG_DIR'] !== undefined && env['GH_CONFIG_DIR'] !== '' ? env['GH_CONFIG_DIR'] : join(env['HOME'] ?? homedir(), '.config', 'gh');
  const asksOrigin = connector === 'bitbucket' && (override === undefined || override === '');
  const origin = asksOrigin ? await runProcess('git', ['config', '--get', 'remote.origin.url'], { cwd: options.repoRoot }) : null;
  return budgetAccountOf(connector, {
    override,
    hostsYml: connector === 'github' ? await textOf(join(configDir, 'hosts.yml')) : null,
    originUrl: origin !== null && origin.code === 0 && origin.stdout.trim() !== '' ? origin.stdout.trim() : null,
    jiraEmailSha256: email === '' ? null : createHash('sha256').update(email).digest('hex'),
  });
};
