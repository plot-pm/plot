/** The `## Plot Config` key that declares the git host's hourly request limit. */
export const HOST_RATE_LIMIT_KEY = 'Host rate limit';

/** The predicted hourly limit where the key is unset or does not read as a limit. */
export const DEFAULT_PREDICTED_HOST_LIMIT = 10_000;

/** A limit the key may declare: a positive whole number with no leading zero. */
const DECLARED = /^[1-9][0-9]*$/;

/**
 * The hourly request limit the `Host rate limit` key declares.
 *
 * A declared duplicate of the `bitbucket` arm of `budget_reading` in
 * `plot-host.sh`, held to it by `corpus/declared-host-limit.corpus.test.ts`.
 * The value is read as `plot-config.sh get` prints it. A positive whole number
 * written in digits only is the limit; any other value, and an empty one,
 * answer {@link DEFAULT_PREDICTED_HOST_LIMIT}.
 *
 * @param value - the key's value, or `''` where the key is unset.
 * @returns the predicted hourly limit.
 */
export const declaredHostLimit = (value: string): number =>
  DECLARED.test(value) ? Number(value) : DEFAULT_PREDICTED_HOST_LIMIT;
