/** The account a ledger entry carries where no email is known or none can be hashed. */
export const UNKNOWN_BUDGET_ACCOUNT = 'unknown';

/** How many hex digits of the digest the account keeps. */
const DIGEST_DIGITS = 12;

/**
 * The account a tracker's ledger entries are keyed on, derived from its email.
 *
 * A declared duplicate of `jira_budget_account` in `plot-host.sh`, held to it
 * by `corpus/jira-budget-account.corpus.test.ts`. The account is the connector
 * word, a colon, and the first 12 hex digits of the SHA-256 of the email's
 * UTF-8 bytes, so the ledger holds no address and two accounts stay two keys.
 * An empty email, and a hasher that answers nothing, both answer `unknown`;
 * the email itself is never the answer.
 *
 * @param input - the email, the connector word the shell prefixes, and the hasher.
 * @returns the account.
 */
export const jiraBudgetAccount = (input: {
  readonly email: string;
  readonly connector: string;
  readonly sha256Hex: (text: string) => string | null;
}): string => {
  if (input.email === '') return UNKNOWN_BUDGET_ACCOUNT;
  const digest = input.sha256Hex(input.email);
  return digest === null || digest === '' ? UNKNOWN_BUDGET_ACCOUNT : `${input.connector}:${digest.slice(0, DIGEST_DIGITS)}`;
};
