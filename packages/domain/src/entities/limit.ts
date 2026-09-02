import { z } from 'zod';

/**
 * How a limit reading was come by.
 *
 * `actual`     the connector has a rate-limit API or sends limit headers, and
 *              this is what it said.
 * `predicted`  the connector offers nothing to ask, so the adapter supplied a
 *              value from experience.
 * `unknown`    neither — the connector reports no limit and the adapter has no
 *              prediction to offer.
 *
 * The pair `actual | predicted` is the one the design settles; `unknown` is the
 * third value the repo has twice shipped a collapse of. It is NOT *free*: a
 * connector nobody can read a limit from is one whose limit is not known, and
 * a caller that reads that as unlimited spends until the refusal.
 *
 * Read this beside `StateSourceSchema` and `stateFailureMode` — the same idea
 * one level down. `actual` decays the moment it is read; `predicted` is wrong
 * until something proves it; `unknown` cannot be wrong and cannot be used.
 */
export const LimitBasisSchema = z.enum(['actual', 'predicted', 'unknown']);
export type LimitBasis = z.infer<typeof LimitBasisSchema>;

/**
 * How a limit of each basis goes wrong.
 *
 * @param basis - how the reading was come by.
 * @returns the failure mode that basis is prone to.
 */
export const limitFailureMode = (basis: LimitBasis): string => {
  switch (basis) {
    case 'actual':
      return 'decaying instantly';
    case 'predicted':
      return 'being wrong until a refusal proves it';
    case 'unknown':
      return 'being read as free';
  }
};

/**
 * What one connector answers about its own limit.
 *
 * ORTHOGONAL TO `PortResult`, and the distinction is the point. `answered |
 * failed | unaskable` says whether the question could be put; `basis` says how
 * the answer was come by. A `predicted` limit is *answered* — the adapter is
 * not failing, it is telling the truth about what it knows.
 *
 * The bucket is the connector's OWN word, unvalidated: GitHub names `core` and
 * `graphql` in `X-RateLimit-Resource`, Bitbucket names something else, and a
 * connector nobody has written an adapter for yet will name a third thing. A
 * closed set here is the edit that gets forgotten when GitLab arrives.
 */
export interface LimitReading {
  /** The connector's own name — `github`, `bitbucket`, `jenkins`; not validated. */
  connector: string;
  /** The bucket the limit applies to, in the connector's own word; '' where it has none. */
  bucket: string;
  /** How many calls the window allows; null where the basis is `unknown`. */
  limit: number | null;
  /** How many remain; null where the connector does not report it. */
  remaining: number | null;
  /** When the window resets, as epoch milliseconds; null where unreported. */
  resetAt: number | null;
  /** How the reading was come by. */
  basis: LimitBasis;
}

/**
 * Builds a reading a connector actually reported.
 *
 * @param reading - the connector, its bucket, and what it said.
 * @returns the reading, tagged `actual`.
 */
export const actualLimit = (reading: {
  connector: string;
  bucket: string;
  limit: number;
  remaining: number | null;
  resetAt: number | null;
}): LimitReading => ({ ...reading, basis: 'actual' });

/**
 * Builds a reading the adapter supplied from experience.
 *
 * `remaining` and `resetAt` are null and stay null: a prediction is about the
 * ceiling, and a connector that reports no limit reports no spend against one
 * either. Inventing a remaining count would let a caller read a guess as a
 * measurement.
 *
 * @param connector - the connector's own name.
 * @param bucket - the bucket the prediction is about; '' where it has none.
 * @param limit - the predicted ceiling.
 * @returns the reading, tagged `predicted`.
 */
export const predictedLimit = (
  connector: string,
  bucket: string,
  limit: number,
): LimitReading => ({
  connector,
  bucket,
  limit,
  remaining: null,
  resetAt: null,
  basis: 'predicted',
});

/**
 * Builds the reading of a connector that reports no limit and has no prediction.
 *
 * NEVER *free*. A null limit means the ceiling is not known, and the caller
 * that reads it must not spend as though there were none.
 *
 * @param connector - the connector's own name.
 * @param bucket - the bucket asked about; '' where it has none.
 * @returns the reading, tagged `unknown`, with a null limit.
 */
export const unknownLimit = (connector: string, bucket = ''): LimitReading => ({
  connector,
  bucket,
  limit: null,
  remaining: null,
  resetAt: null,
  basis: 'unknown',
});

/**
 * The floor a correction may not drive a prediction below.
 *
 * One call. A prediction corrected to zero is a connector that can never be
 * called again, which no observation licenses: a refusal proves the previous
 * guess was too high, not that the connector is shut.
 */
export const MIN_PREDICTED_LIMIT = 1;

/**
 * How far a refused prediction drops.
 *
 * Halving, because a refusal says only *lower than this* — it carries no number
 * of its own. A fixed decrement would take as many refusals to correct a wildly
 * wrong guess as a nearly-right one; halving converges in a session's worth of
 * refusals whatever the starting error.
 */
const CORRECTION_FACTOR = 0.5;

/**
 * Corrects a prediction with the refusal that disproved it.
 *
 * THE PIECE A STATIC DEFAULT CANNOT HAVE. A number shipped in Plot is stale the
 * moment a vendor changes it; a number corrected by the refusal it caused
 * cannot be. `host_failure_kind` in `plot-host.sh` classifies the stderr as
 * `throttled`, and that word is the evidence this reads.
 *
 * ONLY A SPENT QUOTA MOVES THE NUMBER. `secondary` is a refusal too, and it is
 * evidence about a DIFFERENT ceiling: it bounds requests at once, not requests
 * an hour, so halving an hourly prediction on it would correct a number the
 * refusal says nothing about. The concurrency bound is
 * `bug/the-budget-bounds-simultaneous-calls` and deliberately not this.
 *
 * Only a `predicted` reading moves. An `actual` one is what the connector
 * itself said, so a refusal beside it means something other than a wrong
 * ceiling — a secondary limit, a burst — and lowering the reported number would
 * overwrite a measurement with an inference. An `unknown` one has no value to
 * correct.
 *
 * @param reading - the reading a call was made against.
 * @param observed - what the call observed: `throttled` is the spent quota.
 * @returns the corrected reading, or the same reading where nothing was learnt.
 */
export const correctForRefusal = (
  reading: LimitReading,
  observed: 'ok' | 'throttled' | 'secondary',
): LimitReading => {
  if (observed !== 'throttled') return reading;
  if (reading.basis !== 'predicted' || reading.limit === null) return reading;
  const lowered = Math.max(
    MIN_PREDICTED_LIMIT,
    Math.floor(reading.limit * CORRECTION_FACTOR),
  );
  return { ...reading, limit: lowered };
};
