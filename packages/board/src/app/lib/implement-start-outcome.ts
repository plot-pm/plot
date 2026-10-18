/** What `POST /api/implement` came to, as the button shows it. */
export type ImplementStartOutcome = { kind: 'running' } | { kind: 'failed'; message: string };

/**
 * Reads the answer to `POST /api/implement`.
 *
 * A 409 whose body carries `running: true` is the refusal of a second start
 * while a run holds the slug, and `holder` names that run. The button follows
 * only `holder: 'implement'` — this checkout's implement run, whose state file
 * `GET /api/implement/<slug>` reads. A brief run writes no state file and a desk
 * run writes its own, so for those, and for any other non-2xx answer, the
 * outcome is a failure carrying the refusal's sentence.
 *
 * @param status - the HTTP status.
 * @param body - the parsed JSON body.
 * @returns `running` for a 2xx answer or this checkout's running refusal, otherwise `failed` with the sentence to show.
 */
export const implementStartOutcome = (status: number, body: Record<string, unknown>): ImplementStartOutcome => {
  if (status >= 200 && status < 300) return { kind: 'running' };
  if (status === 409 && body.running === true && body.holder === 'implement') return { kind: 'running' };
  // `detail` first: the refusals carry it, and it is the sentence that says which one happened.
  const said = [body.detail, body.error].find((v): v is string => typeof v === 'string');
  return { kind: 'failed', message: said ?? `HTTP ${status}` };
};
