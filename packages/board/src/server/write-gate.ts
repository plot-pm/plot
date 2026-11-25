import type http from 'node:http';
import { dispatchAvailability } from './dispatch.js';

/**
 * THE LOOPBACK BOUNDARY, MADE A GATE.
 *
 * Every write endpoint on this server rests on one sentence: *whoever reaches
 * this address is sitting at the machine that owns the worktrees, and that IS
 * the permission*. `dispatch.ts` has stated it since the first write route
 * existed, and `/api/dispatch`, `/api/approve` and `/api/continue` each checked
 * it on the way in.
 *
 * It was never enforced. `HOST` was read once (`index.ts`), passed to the
 * handlers as a fact about the binding, and each handler chose to consult it.
 * Verified 2026-08-19: nothing stopped `HOST=0.0.0.0`, and the plan that
 * licensed this slice says *"loopback is the boundary and already in force"* —
 * which held only while nobody set it.
 *
 * ONE CHECK IN THE ROUTER, NOT FIVE IN THE HANDLERS. The per-handler shape is
 * the one this repo calls a rule: correct today, and correct tomorrow only if
 * every future write route remembers. Two of the five already differed in what
 * they consulted. Placing the check where routes are DISPATCHED means a sixth
 * write endpoint inherits it by construction — the same argument the blanket
 * 405 makes one branch further down, and for the same reason: a default that
 * refuses is a gate, a check every route must remember is not.
 *
 * IT DOES NOT REPLACE THE PER-CAPABILITY FLAGS. `dispatchAvailability` and its
 * two siblings still answer *will this button act* for the client, and still
 * ride on `/api/board`. This answers *will the server serve it at all*, which
 * is a different question asked at a different time, and the gate is the one
 * that has to be true.
 */

/**
 * The variable that opened every write route on any bind until issue #3311.
 * The gate reads it only to say that it no longer opens anything.
 */
const REMOVED_OPT_IN = 'PLOT_BOARD_ALLOW_REMOTE_WRITES';

export interface WriteGateVerdict {
  /** Whether a write endpoint may be served at all. */
  allowed: boolean;
  /** Empty when allowed; a sentence naming the cause AND the escape otherwise. */
  reason: string;
}

/**
 * May this server serve its write endpoints?
 *
 * Loopback is `localhost`, `127.0.0.1`, `::1` — the set `dispatchAvailability`
 * has always used, IMPORTED rather than restated so the two answers cannot
 * drift into disagreeing about what loopback means. Notably `0.0.0.0` is not in
 * it: it is the wildcard bind, reachable from every interface the machine has,
 * and it is exactly what the fleet user test uses to read the board over
 * Tailscale. A phone may read this board. It may not approve from it.
 *
 * The refusal names what was refused, the two routes that keep the board on
 * loopback (`tailscale serve` with `PLOT_BOARD_ORIGINS`, and an SSH tunnel),
 * and, where `PLOT_BOARD_ALLOW_REMOTE_WRITES` is still set in `env`, that it no
 * longer opens the gate. No variable opens it.
 */
export function writeGate(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): WriteGateVerdict {
  if (dispatchAvailability(host).available) return { allowed: true, reason: '' };
  const removed =
    env[REMOVED_OPT_IN] !== undefined
      ? ` ${REMOVED_OPT_IN} is set, and it no longer opens the write endpoints on any bind.`
      : '';
  return {
    allowed: false,
    reason:
      `this board is bound to ${host}, which is not loopback, so its write endpoints are refused: ` +
      'reaching a loopback address is what stands in for authentication here, and a non-loopback ' +
      'binding is reachable by things that are not sitting at this machine. ' +
      'To write from another machine, keep the board on loopback and reach it through ' +
      '`tailscale serve` with the served origin in PLOT_BOARD_ORIGINS, or through an SSH tunnel: ' +
      '`ssh -L <port>:localhost:<port> <machine>`.' +
      removed,
  };
}

/**
 * Refuse a write request when the gate is shut, and say so. Returns whether it
 * refused, so the caller stops.
 *
 * 403 rather than 404: hiding the endpoint would be a lie about what this
 * server is, and the developer this message exists for already knows the route
 * is there — they are asking why it will not act.
 */
export function refuseIfGated(
  res: http.ServerResponse,
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const verdict = writeGate(host, env);
  if (verdict.allowed) return false;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: verdict.reason }));
  return true;
}
