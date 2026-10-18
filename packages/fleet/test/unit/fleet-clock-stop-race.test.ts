import { describe, expect, it } from 'vitest';

import { bindChannelSlot, type ChannelSlot } from '../../src/server/entry/registryd-main.js';

/**
 * Reproduces #1526 bullet 2: a bind retry that resolves after the daemon has
 * read `stop()` true must not write the channel it opened — the stop path
 * has already run `slot.channel?.stop()` by then and will never see it.
 */
describe('bindChannelSlot discards a bind that resolves after stop (#1526 bullet 2)', () => {
  it('stops the just-opened channel and leaves the slot empty where stopped() reads true', async () => {
    const slot: ChannelSlot = { channel: null, indexMonitor: null, deskRelay: null };
    const stopCalls: string[] = [];
    let releaseOpen: (() => void) | undefined;
    const open = () =>
      new Promise<{ stop: () => Promise<void> } | null>((resolve) => {
        releaseOpen = () =>
          resolve({
            stop: async () => {
              stopCalls.push('channel.stop');
            },
          });
      });

    let stopRead = false;
    // @ts-expect-error — a minimal RunningChannel stand-in for this race.
    const pending = bindChannelSlot(slot, open, () => ({ indexMonitor: null, deskRelay: null }), undefined, () => stopRead);

    // The daemon's stop path reads stop() true and runs scanClock?.idle() —
    // which, in the real stop path, waits for this very call — but the stop
    // flag itself flips here, before the bind resolves.
    stopRead = true;
    releaseOpen?.();
    const bound = await pending;

    expect(bound).toBe(false);
    expect(slot.channel).toBeNull();
    // THE OPENED CHANNEL IS STOPPED, not left running unseen by anything.
    expect(stopCalls).toEqual(['channel.stop']);
  });

  it('writes the channel and calls onBound where stopped() still reads false', async () => {
    const slot: ChannelSlot = { channel: null, indexMonitor: null, deskRelay: null };
    const bound: string[] = [];
    // @ts-expect-error — a minimal RunningChannel stand-in for this race.
    const ok = await bindChannelSlot(
      slot,
      async () => ({ stop: async () => undefined }),
      () => ({ indexMonitor: null, deskRelay: null }),
      () => bound.push('bound'),
      () => false,
    );

    expect(ok).toBe(true);
    expect(slot.channel).not.toBeNull();
    expect(bound).toEqual(['bound']);
  });
});
