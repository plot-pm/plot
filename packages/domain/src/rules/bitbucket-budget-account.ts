/** The account a ledger entry carries where nothing names one. */
export const UNKNOWN_BUDGET_ACCOUNT = 'unknown';

/** The owner segment `budget_account` captures from a remote URL. */
const OWNER = /^.*[:/]([^/]+)\/[^/]+(\.git)?$/;

/**
 * The account a Bitbucket ledger entry is charged to: the `origin` remote's workspace.
 *
 * A declared duplicate of the `bitbucket` arm of `budget_account` in
 * `plot-host.sh`, held to it by `corpus/bitbucket-budget-account.corpus.test.ts`.
 * A non-empty `PLOT_BUDGET_ACCOUNT` wins. Otherwise each line of the remote URL
 * is replaced by the segment before its last `/<repo>`, as the shell's `sed -E`
 * does, and a line that does not match stays whole. An empty answer reads as
 * `unknown`. Two checkouts of one workspace therefore share one budget key on
 * both transports.
 *
 * @param remoteUrl - `remote.origin.url`, or null where the repository has no `origin`.
 * @param override - the value of `PLOT_BUDGET_ACCOUNT`, or undefined where it is unset.
 * @returns the account.
 */
export const bitbucketBudgetAccount = (remoteUrl: string | null, override: string | undefined): string => {
  if (override !== undefined && override !== '') return override;
  const text = (remoteUrl ?? '').replace(/\n+$/, '');
  const who = text === '' ? '' : text.split('\n').map((line) => line.replace(OWNER, '$1')).join('\n');
  return who === '' ? UNKNOWN_BUDGET_ACCOUNT : who;
};
