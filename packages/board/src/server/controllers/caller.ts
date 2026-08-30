/**
 * What a controller-layer caller may do — the *who is asking* half of the seam.
 *
 * The estate question ("what is true?") is {@link boardState}'s. This answers
 * the other one, and it is deliberately NOT in the domain package: every
 * implementation here compares a `host` string, which is transport knowledge,
 * and the purity gate over `packages/domain/src` exists to keep exactly that
 * out.
 */

/** A capability's answer: may this caller act, and if not, why not. */
export interface CallerAvailability {
  available: boolean;
  reason: string;
}

/**
 * Is this request from the machine that owns the worktrees?
 *
 * Loopback only. A board reachable over the network (a Tailscale address, say)
 * is deliberately NOT localhost: it is reachable from elsewhere, and "sitting
 * at this machine" stops being true the moment it is.
 *
 * This is a refusal to invent an auth scheme, not an oversight. A hand-rolled
 * token in a URL would look like security while being a shared secret in shell
 * history. When the board legitimately needs to act over a network, that is a
 * plan with an auth design in it — not a flag.
 *
 * @param host the host this server is bound to
 * @returns whether the caller is local to the worktrees
 */
export const isLocalCaller = (host: string): boolean =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

/**
 * Build a capability answer from the local-caller check and one refusal
 * sentence.
 *
 * ONE predicate, many messages. Measured 2026-08-30: the comparison above was
 * written out six times across `dispatch`, `continue`, `idea`, `implement`,
 * `drop` and `story`, with four more capabilities delegating to those. What
 * genuinely differed between the six was never the condition — it was the
 * sentence naming what is unavailable, which is why that stays a parameter
 * rather than being collapsed too.
 *
 * The capabilities keep their separate functions on purpose. A single flag
 * answering several capabilities is precisely how they diverge without anyone
 * noticing; the day one of them needs a condition the others lack, there is
 * already a seam to put it in.
 *
 * @param host the host this server is bound to
 * @param what the activity named in the refusal, e.g. "starting work"
 * @param owns what the machine owns — "the worktrees" or "the repo"
 * @returns available with an empty reason, or unavailable with the sentence
 */
export const localCapability = (
  host: string,
  what: string,
  owns: string,
): CallerAvailability =>
  isLocalCaller(host)
    ? { available: true, reason: '' }
    : {
      available: false,
      reason: `the board is bound to ${host}, not localhost — ${what} is available only on the machine that owns ${owns}`,
    };
