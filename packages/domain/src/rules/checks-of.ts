/**
 * One item of a pull request's check rollup, as `gh pr list --json
 * statusCheckRollup` exports it: a check run carries `name`, `status` and
 * `conclusion`; a status context carries `context` and `state`. Both carry
 * `startedAt`.
 */
export interface RollupItem {
  readonly name?: unknown;
  readonly context?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly state?: unknown;
  readonly startedAt?: unknown;
}

/** What one rollup item says: `ok` finished and accepted, `wait` unfinished, `bad` anything else. */
export type CheckWord = 'ok' | 'wait' | 'bad';

/** What a whole rollup says. */
export type ChecksColour = 'green' | 'pending' | 'failing' | 'none';

/** The conclusions a finished item is accepted with. */
const ACCEPTED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

/** The status and state words of an unfinished item; `''` is one of them. */
const UNFINISHED = ['', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'PENDING', 'EXPECTED'];

/**
 * jq's alternative operator `//`: the value, or the fallback where the value
 * is null, false or absent.
 *
 * @param value - the value jq reads.
 * @param fallback - what `//` answers instead.
 * @returns the value or the fallback.
 */
export const jqOr = (value: unknown, fallback: unknown): unknown => (value === null || value === undefined || value === false ? fallback : value);

/**
 * The word for one rollup item: `plot-host.sh`'s jq function `ck` in
 * `CHECKS_OF`, a declared duplicate held by `corpus/checks-of.corpus.test.ts`.
 *
 * An item with a conclusion and a `COMPLETED` or empty status is `ok` for
 * `SUCCESS`, `NEUTRAL` and `SKIPPED` and `bad` otherwise. An item whose status,
 * or else state, is unfinished is `wait`. A status context whose state is
 * `SUCCESS` is `ok`. Every other item is `bad`.
 *
 * @param item - one rollup item.
 * @returns the item's word.
 */
export const checkWord = (item: RollupItem): CheckWord => {
  const conclusion = jqOr(item.conclusion, '');
  const status = jqOr(item.status, '');
  const word = status !== '' ? status : jqOr(item.state, '');
  if (conclusion !== '' && (status === '' || status === 'COMPLETED')) return ACCEPTED.includes(conclusion as string) ? 'ok' : 'bad';
  if (UNFINISHED.includes(word as string)) return 'wait';
  return status === '' && word === 'SUCCESS' ? 'ok' : 'bad';
};

/**
 * The colour of a list of rollup items: jq's `colour_of`.
 *
 * @param items - the items.
 * @returns `none` for no item, `failing` where one is `bad`, `pending` where
 *   one is `wait`, and `green` otherwise.
 */
export const colourOf = (items: readonly RollupItem[]): ChecksColour => {
  if (items.length === 0) return 'none';
  const words = items.map(checkWord);
  if (words.includes('bad')) return 'failing';
  return words.includes('wait') ? 'pending' : 'green';
};

/**
 * The colour of a pull request's whole rollup: jq's `checks_of`.
 *
 * @param rollup - the exported `statusCheckRollup`; null where `gh` exported none.
 * @returns the colour; `none` for a null rollup.
 */
export const checksOf = (rollup: readonly RollupItem[] | null | undefined): ChecksColour => colourOf(rollup ?? []);

/** The status context `plot-host.sh` reads as the review verdict. */
export const PLOT_REVIEW_CONTEXT = 'plot/review';

/**
 * The colour of a rollup without its `plot/review` item: jq's `ci_checks_of`.
 * An item is left out where its `context`, or else its `name`, is `plot/review`.
 *
 * @param rollup - the exported `statusCheckRollup`; null where `gh` exported none.
 * @returns the colour of the other items.
 */
export const ciChecksOf = (rollup: readonly RollupItem[] | null | undefined): ChecksColour =>
  colourOf((rollup ?? []).filter((item) => jqOr(item.context, jqOr(item.name, '')) !== PLOT_REVIEW_CONTEXT));
