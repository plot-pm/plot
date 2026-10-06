/**
 * Whether a slice has reached `Slice max spend` and may start no further run.
 *
 * **DECIDED BEFORE EACH RUN, FROM THE RECORD, NEVER FROM A RUNNING SESSION.**
 * The same shape {@link runLimitRefusal} already takes for `Slice max runs`:
 * the loop reads the record's derived cost and asks this before starting the
 * next run, rather than a running session watching its own spend.
 *
 * **TAKES ONLY `costUsd`, NOT THE WHOLE `SpendRead`.** `agentLoop` carries no
 * state and opens no file — it is handed the derived cost as one more reading
 * in {@link AgentLoopReadings}, same as every other field there, rather than
 * the full read `readSliceSpend` produces.
 *
 * **`limit` HAS NO DEFAULT, AND THAT IS THE CALLER'S TO ENCODE.** `Slice max
 * spend` and `Agent max spend` are the two keys this wave adds with no
 * fallback — a missing key means no limit, not a limit of `0` — so a caller
 * with no configured limit must not call this at all rather than pass a
 * sentinel through it.
 *
 * **AN UNMEASURED SLICE NEVER REFUSES.** `read.costUsd` is `null` for
 * `absent` and `unreadable` states alike — "not measured" is never read as
 * "spent nothing" elsewhere in this estate, and it is not read as "spent
 * everything" here either. A record that cannot be read is a reason to run
 * and find out, not a reason to stop.
 *
 * @param read - the `costUsd` field of what {@link readSpend} returned for this branch.
 * @param limit - `Slice max spend`, in dollars; the caller's job to have
 *   resolved from config, with no default standing in for an absent key.
 * @returns `true` where the branch's recorded cost is at or past `limit`.
 */
export const sliceSpendRefusal = (read: { costUsd: number | null }, limit: number): boolean =>
  read.costUsd !== null && read.costUsd >= limit;
