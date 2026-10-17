/** What `POST /api/implement` came to, as the button shows it. */
export type ImplementStartOutcome = { kind: 'running' } | { kind: 'failed'; message: string };

/**
 * Reads the answer to `POST /api/implement`.
 *
 * A 409 whose body carries `running: true` is the refusal of a second start
 * while a run holds the slug; the button follows that run. Any other non-2xx
 * answer, including a 409 for a missing `Implement command`, is a failure.
 *
 * @param status - the HTTP status.
 * @param body - the parsed JSON body.
 * @returns `running` for a 2xx answer or the running refusal, otherwise `failed` with the sentence to show.
 */
export const implementStartOutcome = (status: number, body: Record<string, unknown>): ImplementStartOutcome => {
  if (status >= 200 && status < 300) return { kind: 'running' };
  if (status === 409 && body.running === true) return { kind: 'running' };
  // `detail` first: the refusals carry it, and it is the sentence that says which one happened.
  const said = [body.detail, body.error].find((v): v is string => typeof v === 'string');
  return { kind: 'failed', message: said ?? `HTTP ${status}` };
};
