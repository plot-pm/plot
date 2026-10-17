import { describe, it, expect } from 'vitest';
import { bindNext, announceReady, type BindListen } from '../../src/server/bind-chain.js';

/**
 * THE READY LINE WAITS FOR EVERY BIND — the race `2026-10-17-the-ready-line-waits-for-every.md`
 * fixes, and the done-when it names: a unit test drives the extracted chain
 * with an INJECTED listen, releases each bind's callback by hand, and asserts
 * the ready line prints only after the LAST one settles.
 *
 * No real sockets and no real server — `bind-chain.ts` takes `listen` as a
 * parameter precisely so this file can hold the chain open with a fake one,
 * which is also why this test belongs in `test/unit`: that project is gated
 * against any file mentioning `startServer` (see
 * `parallel-project-takes-no-resource.test.ts`), and a fake `listen` never
 * touches a socket.
 */
describe('the ready line waits for every bind to settle', () => {
  it('prints only after the LAST bind calls back, not the first', () => {
    const log: string[] = [];
    const released: Array<() => void> = [];
    const fakeListen: BindListen = (_address, _port, cb) => {
      released.push(cb);
    };

    bindNext(['::1', '127.0.0.1'], 7777, fakeListen, {
      host: 'localhost',
      log: (m) => log.push(m),
    });

    // Two addresses queued, neither released yet — nothing has printed.
    expect(log).toHaveLength(0);
    expect(released).toHaveLength(1);

    // Release the FIRST bind by hand. One address remains, so the chain is
    // not yet at its terminal case.
    released[0]();
    expect(log).toHaveLength(0);
    expect(released).toHaveLength(2);

    // Release the LAST bind. `rest` is now empty — the terminal case — and
    // only now does the ready line print.
    released[1]();
    expect(log).toEqual(['Plot board: http://localhost:7777']);
  });

  it('prints immediately when there is nothing to bind beyond the first', () => {
    // Under `HOST`, `BIND_ADDRESSES` becomes a single-element array, so the
    // chain's remaining list is already empty — the terminal case is reached
    // with zero releases, not after one that never comes.
    const log: string[] = [];
    const fakeListen: BindListen = () => {
      throw new Error('must not bind anything when rest is empty');
    };

    bindNext([], 7777, fakeListen, { host: '192.168.1.5', log: (m) => log.push(m) });

    expect(log).toEqual(['Plot board: http://localhost:7777']);
  });
});

describe('announceReady', () => {
  it('prints the tailscale line after the ready line when the host is the wildcard', async () => {
    const log: string[] = [];
    announceReady(7777, {
      host: '0.0.0.0',
      log: (m) => log.push(m),
      privateAddress: async () => '100.64.0.1',
    });

    expect(log).toEqual(['Plot board: http://localhost:7777']);
    // The mesh lookup is awaited asynchronously, so give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual([
      'Plot board: http://localhost:7777',
      '  tailscale:  http://100.64.0.1:7777',
    ]);
  });

  it('prints nothing extra when the mesh has no address', async () => {
    const log: string[] = [];
    announceReady(7777, {
      host: '0.0.0.0',
      log: (m) => log.push(m),
      privateAddress: async () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).toEqual(['Plot board: http://localhost:7777']);
  });

  it('never calls privateAddress when the host is not the wildcard', () => {
    const log: string[] = [];
    announceReady(7777, {
      host: 'localhost',
      log: (m) => log.push(m),
      privateAddress: async () => {
        throw new Error('must not be called for a non-wildcard host');
      },
    });

    expect(log).toEqual(['Plot board: http://localhost:7777']);
  });
});
