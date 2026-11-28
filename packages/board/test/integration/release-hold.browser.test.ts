import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, scenario, row, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';

/**
 * The person hold of a release is SEEN. `releaseHoldView`, `releaseHoldRowLine`,
 * `releaseHoldButton` and `releaseLiftButton` decide every text and state, and
 * `release-hold-person.test.ts` holds them; this test proves the release row shows
 * the hold line and both buttons, the Hold disabled with its reason and the Lift enabled.
 * It clicks nothing.
 */
const HEAD = 'a'.repeat(40);
const SINCE = Date.parse('2026-11-27T20:31:00.000Z');

describe('the Release group shows a person hold', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  it('shows the hold line, the disabled Hold with its reason and the enabled Lift', async () => {
    const base = scenario('ten-rows-one-kind-each');
    const { agents: _a, summary: _s, rows, ...envelope } = base.fleet;
    const release = row({
      kind: 'release', version: '2.7.0', plan: '', planFile: '', wave: '', group: 'waiting-on-you',
      branch: 'changeset-release/main', branchUrl: 'https://host/tree/changeset-release/main', ageMinutes: 12,
      pr: { number: 300, url: 'https://host/pull/300', draft: false, state: 'green', open: true, headSha: HEAD },
    });
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: {
        fleet: buildFleet({ ...envelope, rows: [...rows, release] }),
        board: {
          ...base.board,
          releaseHold: {
            hold: { holds: true, pr: 300, head: HEAD, since: SINCE, end: SINCE + 3_600_000 },
            holdable: 'holdable',
            pr: 300,
            head: HEAD,
            held: [],
          },
        },
      },
    });
    try {
      const line = page.locator('[data-release-group] [data-release-hold-line]');
      await expect.poll(() => line.count(), { timeout: 10_000 }).toBe(1);
      expect(await line.textContent()).toBe('holds merges since 20:31 UTC · ends 21:31 UTC');
      const hold = page.getByTestId('release-hold-button');
      const lift = page.getByTestId('release-hold-lift');
      expect(await hold.isEnabled()).toBe(false);
      expect(await hold.getAttribute('title')).toBe('merges are held until 21:31 UTC');
      expect(await lift.isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  });
});
