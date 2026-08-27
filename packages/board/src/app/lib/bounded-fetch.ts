/**
 * The bound every client fetch waits under, and the words a reader gets when it
 * elapses.
 *
 * An unbounded `fetch` against a server that has DIED does not reject — it
 * hangs. The socket was accepted, the request headers went out, and then the
 * peer stopped speaking; from the browser's side that is indistinguishable from
 * a peer still thinking. The promise stays pending forever, so a `.catch` that
 * is written correctly never runs and a `Loading…` arm renders for as long as
 * the view is open.
 *
 * That matters here more than it would elsewhere, because `pnpm board` runs
 * under `node --watch`: EVERY rebuild, pull and artifact write restarts the
 * server under whatever request is in flight. This is not a rare network fault,
 * it is the board's normal operating mode. Measured 2026-08-26 — a plan panel
 * sat on `Loading…` indefinitely while the route itself served 200/18 KB when
 * tested the same minute.
 */

/**
 * How long a one-shot document fetch waits before calling the server dead.
 *
 * A CEILING, not a target — the same framing `ci.yml`'s `timeout-minutes: 25`
 * uses: a wedged step never returns and sits there looking like work.
 *
 * Chosen against the MEASURED slow case, not against what feels responsive,
 * because the bound that catches a dead server but undercuts a real slow load
 * turns a working board into a broken-looking one. The largest plan measured
 * here is ~18 KB from local disk — milliseconds. 10 s is roughly a thousand
 * times the observed load and still well inside a reader's patience.
 */
export const DOC_FETCH_TIMEOUT_MS = 10_000;

/**
 * How long an action request waits — the POST that asks for work, and the
 * status route polled afterwards to learn what happened.
 *
 * Wider than the doc bound because the far side is doing more: these routes
 * touch git and the host CLI before they answer. It is still a CEILING over a
 * request that ANSWERS PROMPTLY BY DESIGN — every one of these endpoints
 * detaches its command and replies 202 immediately (`reslice.ts:316`), so the
 * agent's own runtime is never what this bound is measuring. A request still
 * outstanding at 15 s did not reach a server that was going to answer.
 */
export const ACTION_TIMEOUT_MS = 15_000;

/**
 * What a reader is told when the bound elapses.
 *
 * `Failed to load plan: TimeoutError` is technically true and useless: a reader
 * who sees an exception class has learned nothing they can act on. The board
 * restarts constantly under `node --watch`, so the message says THAT and says
 * what to do about it. Same standard `a-degraded-scan-says-why` sets for the
 * scan — report what it means and what to do, not what threw.
 */
export const DOC_TIMEOUT_MESSAGE =
  'the request timed out. The board restarts when its files change; close and reopen.';

/**
 * True for the rejection `AbortSignal.timeout` produces, and ONLY that one.
 *
 * The discriminator is `name`, not `instanceof`: both a elapsed bound and a
 * caller's own `controller.abort()` arrive as a `DOMException`, and they are
 * opposite events. A timeout means the server is likely gone and the reader
 * should be told; a caller-initiated abort means the view was closed or
 * superseded, and reporting THAT as a failure would put a red error on screen
 * every time someone changed their mind.
 */
export function isTimeout(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'TimeoutError';
}

/**
 * `fetch`, bounded, with the timeout rejection turned into words a reader can
 * act on. Every other failure keeps its own message — a 500 or a refused
 * connection is not a timeout and `restart the board` would be wrong advice.
 */
export async function fetchDoc(
  url: string,
  timeoutMs: number = DOC_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (isTimeout(e)) throw new Error(DOC_TIMEOUT_MESSAGE);
    throw e;
  }
}
