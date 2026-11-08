import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, row, fleet as buildFleet, type Catalogue } from '../catalogue/index.js';

/**
 * The release row's "Approve release" button is SEEN. `releaseApprovable` in the
 * domain decides it and is unit-tested in `release-approvable.test.ts`; this test
 * proves the page shows it for a ready release and not for one whose review names
 * another commit. It signs nothing.
 */
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const releasePr = (reviewSha: string) => ({
  number: 300,
  url: 'https://host/pull/300',
  draft: false,
  state: 'green' as const,
  open: true,
  headSha: HEAD,
  checksSha: HEAD,
  ciChecks: 'green' as const,
  plotReview: 'success' as const,
  plotReviewSha: reviewSha,
  plotReviewJudged: 'success' as const,
  plotReviewCheckedSha: HEAD,
});

describe('the release row approves itself', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (reviewSha: string): Promise<Page> => {
    const base = scenario('ten-rows-one-kind-each').fleet;
    const { agents: _a, summary: _s, rows, ...envelope } = base;
    const release = row({
      kind: 'release', version: '2.7.0', plan: '', planFile: '', group: 'waiting-on-you',
      branch: 'changeset-release/main', branchUrl: 'https://host/tree/changeset-release/main',
      ageMinutes: 12, pr: releasePr(reviewSha),
    });
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: { fleet: buildFleet({ ...envelope, rows: [...rows, release] }) },
      route: {
        '**/api/passkey': (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registered: true, credentialId: 'cred' }) }),
      },
    });
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  };

  it('shows the button on a ready release row and hides it where the review names another head', async () => {
    const ready = await open(HEAD);
    try {
      const button = ready.getByRole('button', { name: 'Approve release' });
      await expect.poll(() => button.count(), { timeout: 10_000 }).toBe(1);
      await expect.poll(() => button.isEnabled(), { timeout: 10_000 }).toBe(true);
      expect(await ready.locator('[data-testid="passkey-panel"]').count()).toBe(0);
    } finally {
      await ready.close();
    }
    const stale = await open(OTHER);
    try {
      await stale.locator('[data-kind]').first().waitFor({ timeout: 10_000 });
      expect(await stale.getByRole('button', { name: 'Approve release' }).count()).toBe(0);
    } finally {
      await stale.close();
    }
  });
});
