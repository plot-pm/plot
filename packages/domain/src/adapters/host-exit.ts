/**
 * `plot-host.sh`'s exit codes, as numbers and nothing else.
 *
 * ONE FILE NAMES THE INTEGERS; EACH ADAPTER KEEPS ITS OWN READING OF THEM. Two
 * adapters read this script and they are different kinds of port.
 * `adapters/host/host-shell.ts` is a **connector**: it answers *how long to
 * wait*, so it splits 5 into `throttled` and 6 into `secondary`.
 * `adapters/scripts/scripts-shell.ts` is the generic `Scripts` port and
 * collapses both to `failed`, because it carries no limit vocabulary.
 *
 * SO THIS FILE EXPORTS NO PREDICATE AND NO MAPPING. A shared `refusalKindOf`
 * would make one port's answer the other's, which is how connector words reach
 * every filesystem port — the mistake `ports/host.ts` names. What the two may
 * safely share is which integer the script spends on which condition; what
 * that condition obliges a caller to do is the adapter's own.
 *
 * It lives beside `run-script.ts` rather than in `ports/`, because `ci.yml`'s
 * port-completeness gate requires every `ports/<name>.ts` to have a matching
 * `adapters/<name>/` directory, and this is a constant table rather than a
 * source of truth anyone implements.
 *
 * @see `plot-host.sh` — the script that spends these, and the contract this
 *   file mirrors.
 */

/** Every state asked was answered. */
export const EXIT_OK = 0;

/** The question could not be asked — a DNS blip, an auth error, a 404. */
export const EXIT_BROKE = 3;

/** This backend structurally has no such capability, permanently and correctly. */
export const EXIT_UNASKABLE = 4;

/** A spent quota: the bucket is empty and the response carries a reset. */
export const EXIT_QUOTA = 5;

/** A secondary limit: a burst refusal, which clears in seconds and names no reset. */
export const EXIT_SECONDARY = 6;

/**
 * Some states answered and some did not — the rows that answered are on
 * stdout and the failures are named on stderr.
 *
 * SEVEN, BECAUSE THE VOCABULARY IS FULL BELOW IT: 6, 5 and 3 are spent on
 * total refusals, 4 on a missing capability, 1 on a refusal before any call,
 * and 0 on a whole answer. Two is left alone deliberately — it is bash's own
 * code for a misused builtin, and a partial answer sharing it could not be
 * told from a shell-level fault.
 *
 * A TOTAL OUTAGE NEVER ARRIVES AS 7. Where no state answered the script keeps
 * the code it has always had, so a partial answer and an outage stay distinct.
 */
export const EXIT_PARTIAL = 7;
