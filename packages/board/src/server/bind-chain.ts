/**
 * The bind chain that reaches every loopback family on the port the first
 * `listen()` was given, and the ready line that must wait for all of it.
 *
 * ## The race this closes
 *
 * `index.ts` used to print `Plot board: http://localhost:<port>` inside the
 * FIRST bind's callback, then start this chain to bind the rest of
 * `BIND_ADDRESSES`. A client that read that line and connected over IPv4 in the
 * gap before the second bind completed got `ECONNREFUSED 127.0.0.1`. Measured
 * 2026-10-16 in a Linux container (Ubuntu 24.04, node 24, `--cpus=4`): some runs
 * of the board tests failed with that exact error, at the same rate with or
 * without the #1899 same-origin fix — `port.test.mjs`'s "the board answers on
 * both loopback families" suite requests `127.0.0.1` right after the ready
 * line, which is the likely flaky test.
 *
 * The fix moves the print to the point where the chain has nothing left to
 * try: {@link bindNext}'s own terminal case, `address === undefined`, which IS
 * the signal that every address has been attempted. No `Promise.all`, no
 * counter — the recursion already expresses the fact.
 */

/** A `listen` call, injectable so a test can hold the chain open by hand. */
export type BindListen = (address: string, port: number, cb: () => void) => void;

export interface AnnounceReadyOptions {
  /** Prints the ready line and anything that follows it. Defaults to `console.log`. */
  log?: (message: string) => void;
  /** `HOST`, read once rather than from `process.env` on every call. */
  host: string;
  /** Resolves the mesh address to print as `tailscale:`, when `host` is the wildcard. */
  privateAddress?: () => Promise<string | undefined>;
}

/**
 * Prints the ready line, then the `tailscale:` line if `host` is the wildcard.
 *
 * The `tailscale:` line still runs after the ready line — its guarantee is now
 * "after every bind has settled", not "prints first either way", because it is
 * reached from the same terminal case.
 */
export const announceReady = (boundPort: number, options: AnnounceReadyOptions): void => {
  const { log = console.log, host, privateAddress } = options;
  log(`Plot board: http://localhost:${boundPort}`);
  if (host === '0.0.0.0' && privateAddress) {
    // Awaited here rather than blocking the chain: the loopback URL above is
    // what an operator needs, and it has already printed, so a mesh that
    // answers slowly delays a second line and never the server coming up.
    //
    // An absent mesh resolves to `undefined` rather than rejecting — the
    // binary not being installed is the common case, not a fault to report —
    // so there is nothing to catch here and no error path to write.
    void privateAddress().then((address) => {
      if (address) log(`  tailscale:  http://${address}:${boundPort}`);
    });
  }
};

/**
 * Bind the remaining families, one after another, on the port the first bind
 * was given — printing the ready line only once `rest` is exhausted.
 *
 * ALWAYS the bound port, NEVER the originally requested one: under `PORT=0`
 * the request is the literal 0, and asking for it again would have the OS
 * assign a SECOND, different port. The caller passes the port it read off
 * `server.address()` after the first bind settled.
 *
 * A FAILURE PARTWAY THROUGH DEGRADES, IT DOES NOT DIE — that is `listen`'s
 * contract, not this function's: a failing bind still calls back so the chain
 * keeps moving, and the ready line still prints once it ends.
 */
export const bindNext = (
  rest: string[],
  boundPort: number,
  listen: BindListen,
  announce: AnnounceReadyOptions,
): void => {
  const [address, ...remaining] = rest;
  if (address === undefined) {
    announceReady(boundPort, announce);
    return;
  }
  listen(address, boundPort, () => bindNext(remaining, boundPort, listen, announce));
};
