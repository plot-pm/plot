import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { DRAFT_PLAN_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * A FOLDED WAVE HEAD SAYS WHAT ITS VERDICT SAYS — the DOM half, and the only
 * half that catches this bug.
 *
 * `groupedNote` returning `''` for an unknown word is pure and asserted in
 * `test/unit/agent-list.test.ts`. What only a rendered page can settle is that a
 * MULTI-BRANCH wave reaches the verdict arms AT ALL: the `waveNote` call site
 * used to take `groupedCount !== undefined ? groupedNote(groupedWord)` for every
 * wave with more than one branch — `groupedCount` is defined for all of them —
 * so the two verdict clauses below it were DEAD for exactly this population, and
 * the old default asserted `work landed — waiting to be merged` over waves whose
 * branches had never been touched. A test using single-branch waves cannot see
 * it: those reach the verdict by the `soleRow` arm instead, which was never
 * broken. So every wave here carries TWO branches on one name.
 *
 * The fixture is the live population of 2026-08-23, reduced to its two shapes:
 *
 *   `a-dispatch-hands-over-a-brief`  two branches, one wave, verdict `blocked`,
 *                                    plan still in review — the exact case that
 *                                    claimed a merge was pending over branches
 *                                    with no PR, no ref, nothing merged.
 *   `an-eligible-wave`               two branches, one wave, verdict `eligible` —
 *                                    the OTHER dead arm, which a blocked-only
 *                                    fixture would leave unproven.
 *
 * `/api/fleet` is intercepted, so the rows here are the whole input; the scratch
 * repo only starts the server.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Discovery', group: 'waiting-on-you', ageMinutes: null,
  waitingOn: 'time' as const, note: DRAFT_PLAN_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

function fleet(): Fleet {
  // TWO branches per wave, one wave name each: the condition that makes the head
  // GROUPED (`groupedCount > 1`) rather than a sole row, and the only condition
  // under which the dead verdict arms were ever reached.
  const rows: AgentRow[] = [
    // A blocked wave whose plan is still in review: no PR, nothing pushed. The
    // head must NOT claim work landed.
    row({
      plan: 'a-dispatch-hands-over-a-brief', planFile: '2026-08-23-a-dispatch-hands-over-a-brief.md',
      branch: 'feature/hands-over-one', wave: 'Handed over', verdict: 'blocked', blockedBy: 'Earlier',
      branchUrl: `${GH}feature/hands-over-one`,
    }),
    row({
      plan: 'a-dispatch-hands-over-a-brief', planFile: '2026-08-23-a-dispatch-hands-over-a-brief.md',
      branch: 'feature/hands-over-two', wave: 'Handed over', verdict: 'blocked', blockedBy: 'Earlier',
      branchUrl: `${GH}feature/hands-over-two`,
    }),
    // An eligible wave, same shape — the second dead arm.
    row({
      plan: 'an-eligible-wave', planFile: '2026-08-23-an-eligible-wave.md',
      branch: 'feature/eligible-one', wave: 'Ready', verdict: 'eligible', waitingOn: 'you' as const,
      branchUrl: `${GH}feature/eligible-one`,
    }),
    row({
      plan: 'an-eligible-wave', planFile: '2026-08-23-an-eligible-wave.md',
      branch: 'feature/eligible-two', wave: 'Ready', verdict: 'eligible', waitingOn: 'you' as const,
      branchUrl: `${GH}feature/eligible-two`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 2, blocked: 2, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('a folded multi-branch wave head renders its verdict, not a claim', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    // NO fold-expanding: the subject is what the head says while FOLDED.
    return page;
  }

  /** The head of a folded wave — the row that carries `waveNote`. */
  const headNote = (page: Page, wave: string) =>
    page.locator(`[data-wave-row="${wave}"]`).locator('[data-row-note]');

  it('a blocked wave in review reads its verdict, never that work landed', async () => {
    const page = await open();
    try {
      const note = headNote(page, 'Handed over');
      await note.waitFor({ timeout: 5_000 });
      // The verdict, and the whole point of the fix: this wave has two branches,
      // so before the fix the head short-circuited to `groupedNote` and asserted
      // `work landed — waiting to be merged` over branches with no PR.
      await expect.poll(() => note.textContent())
        .toBe('an earlier wave has to land first');
      // Asserted directly and not merely by inequality: the old claim was a
      // specific sentence, and a reworded regression must still fail here.
      expect(await note.textContent()).not.toContain('work landed');
      // The waiting-TONE is deliberately `you` for a grouped head regardless of
      // verdict — a merge is a decision — and that is `waveWaitingOn`'s call, a
      // separate ternary this fix does not touch. Only the SENTENCE is this
      // branch's subject, so only the sentence is asserted.
    } finally {
      await page.close();
    }
  });

  it('an eligible wave reads its verdict too — the other formerly-dead arm', async () => {
    const page = await open();
    try {
      const note = headNote(page, 'Ready');
      await note.waitFor({ timeout: 5_000 });
      await expect.poll(() => note.textContent())
        .toBe('approved — nobody has taken it');
      expect(await note.textContent()).not.toContain('work landed');
    } finally {
      await page.close();
    }
  });
});
