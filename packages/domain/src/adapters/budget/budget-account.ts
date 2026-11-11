import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { budgetAccountOf } from '../../rules/budget-account.js';
import { runProcess } from '../run-script.js';

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
