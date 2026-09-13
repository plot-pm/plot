import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * A CLAIMED SLICE DOES NOT SAY NOBODY TOOK IT.
 *
 * Reported by the operator from their own board, 2026-09-13: the slice
 * `a-harness-this-machine-cannot-run-refuses` appeared with its agent, its desk
 * and its branch, and the same line ended *"eligible — nobody has taken it"*.
 * The payload contradicted itself while the agent ran:
 *
 *     row  kind=wave  verdict=eligible  startability=someone-is-on-it
 *     AGENT branch=bug/a-harness-…  state=running
 *
 * THE TWO FIELDS DISAGREE BY CONSTRUCTION, and that is the fix's evidence
 * rather than its target. `startabilityVerdict` answers both questions in one
 * function, in a fixed order: a `wip` or `claimed` branch returns
 * `someone-is-on-it` at `verdict.ts:56` and never reaches the slice-verdict gate
 * at `:63`. `eligible` means *every prior slice has landed*, and a claim does
 * not un-satisfy a prerequisite. So the verdict is right and the sentence was
 * reading the wrong field.
 *
 * THE ROW IS A BRANCH ROW, AND THAT IS THE PLAN'S ONE WRONG PREMISE. The plan
 * and its brief both place the fix in the client's `sliceNote` chain
 * (`rows.tsx:1069`). Measured here before anything was changed: a claimed
 * branch NEVER reaches it. NOT STARTED filters its slice rows to `isUnbegun`
 * (`AgentList.tsx:1467` — `state === 'open'`), and WORKING is keyed on the
 * registry, so a `claimed` or `wip` branch renders through `Row` and prints the
 * SERVER's note — `ELIGIBLE_NOTE`, passed through `noteWithoutPr` untouched
 * because there is no PR. The probe that settled it rendered:
 *
 *     SLICE | bug/ns-one | p-notstarted | eligible — nobody has taken it | someone is on it
 *
 * — the contradiction within one line, which is the shape the brief predicted
 * and a different producer from the one it named.
 *
 * THE FIXTURE IS THE MEASURED COMBINATION, and each property is load-bearing:
 *
 *   - `startability: 'someone-is-on-it'` WITH `verdict: 'eligible'`. The whole
 *     defect is that they co-occur; a fixture carrying one proves nothing.
 *   - `state: 'claimed'` or `'wip'`. This is what routes the row to `Row` —
 *     an `open` row renders as a slice head and never reaches the code fixed.
 *   - NO PR, so the server's sentence survives `noteWithoutPr` verbatim.
 *
 * A literal payload, fulfilled synchronously, for the reason
 * `slice-in-working.browser.test.ts` records: the subject is a wording decision
 * on the client, so a route that awaits anything fails suites that already
 * passed.
 */

// The branches, so each row can be found by name rather than by position.
const CLAIMED_BRANCH = 'bug/a-harness-this-machine-cannot-run-refuses';
const WIP_BRANCH = 'bug/a-claimed-slice-does-not-say-nobody-took-it';
const FREE_BRANCH = 'feature/genuinely-free';
const OLDER_BRANCH = 'feature/older-server';

/**
 * The word slot 5 already carries for this state, and the reason the note is
 * WITHDRAWN rather than reworded.
 *
 * `startabilityWord` (`tuple-row.ts:1009`) has shipped this exact phrase since
 * `the-row-says-whether-you-can-start-it`. The plan proposed *somebody is on
 * it* for the note, which would put two spellings of one state on one line —
 * the defect class this plan exists to remove. So the fact stays in the slot
 * that already states it and the false sentence goes. See the PR body.
 */
const ON_IT = 'someone is on it';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-09-13-a-plan.md',
  wave: 'w', state: 'claimed', phase: null, group: 'working', ageMinutes: 30,
  waitingOn: null, note: '', pr: null, branchUrl: '', waitingDays: null,
  kind: 'wave', worker: 'none', localDirty: false, localLocked: false,
  blockedBy: null, verdict: null, stuck: null, repair: null, deferredReason: '',
  ...over,
});

/**
 * The operator's board, reduced to its two appearances of one shape.
 *
 * Two DIFFERENT plans, so neither section can group them into one head — the
 * subject is one slice's sentence, not a grouping.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    // THE MEASURED ROW. A claimed branch of an eligible slice, carrying the
    // sentence the server composes for one — `ELIGIBLE_NOTE` — beside a
    // startability that says somebody is already on it.
    row({
      kind: 'wave', group: 'not-started', state: 'claimed',
      plan: 'a-harness-this-machine-cannot-run-refuses',
      planFile: '2026-09-12-a-harness-this-machine-cannot-run-refuses.md',
      branch: CLAIMED_BRANCH, branchUrl: `https://github.com/tiny/garden/tree/${CLAIMED_BRANCH}`,
      wave: 'Refused', ageMinutes: null, waitingDays: 2,
      note: ELIGIBLE_NOTE, verdict: 'eligible', startability: 'someone-is-on-it',
    }),
    // THE SAME SHAPE ONE STATE ALONG. `wip` reaches `someone-is-on-it` by the
    // same line of `startabilityVerdict` as `claimed`, so both must answer — a
    // fixture carrying one leaves the other free to keep the sentence.
    row({
      kind: 'wave', group: 'not-started', state: 'wip',
      plan: 'a-claimed-slice-does-not-say-nobody-took-it',
      planFile: '2026-09-13-a-claimed-slice-does-not-say-nobody-took-it.md',
      branch: WIP_BRANCH, branchUrl: `https://github.com/tiny/garden/tree/${WIP_BRANCH}`,
      wave: 'Claimed', ageMinutes: 12, waitingDays: 2,
      note: ELIGIBLE_NOTE, verdict: 'eligible', startability: 'someone-is-on-it',
    }),
    // THE CONTROL, and it is the population the sentence is CORRECT for. A
    // genuinely unclaimed eligible slice answers `start-work` and must still
    // read its sentence word for word. If this goes red the fix is over-firing.
    row({
      kind: 'wave', group: 'not-started', state: 'open',
      plan: 'a-slice-nobody-has-taken',
      planFile: '2026-09-13-a-slice-nobody-has-taken.md',
      branch: FREE_BRANCH, branchUrl: `https://github.com/tiny/garden/tree/${FREE_BRANCH}`,
      wave: 'Free', ageMinutes: null, waitingDays: 4,
      note: ELIGIBLE_NOTE, verdict: 'eligible', startability: 'start-work',
    }),
    // A NULL STARTABILITY FALLS THROUGH TO TODAY'S BEHAVIOUR — an older server's
    // payload, or a merged branch. This is why the gate is the ONE verdict and
    // not truthiness: `startability` absent must render exactly as before.
    row({
      kind: 'wave', group: 'not-started', state: 'claimed',
      plan: 'an-older-server-said-nothing',
      planFile: '2026-09-13-an-older-server-said-nothing.md',
      branch: OLDER_BRANCH, branchUrl: `https://github.com/tiny/garden/tree/${OLDER_BRANCH}`,
      wave: 'Silent', ageMinutes: 40, waitingDays: 5,
      note: ELIGIBLE_NOTE, verdict: 'eligible', startability: null,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: {
      plans: 4, waves: 4, branches: rows.length, claimed: 3, eligible: 1, blocked: 0, deferred: 0,
    },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as unknown as Fleet;
}

/**
 * One branch row's note and its slot-5 status, read together.
 *
 * TOGETHER, because the defect is the pair: the operator's complaint was not
 * that a sentence was wrong in isolation but that it sat beside the right word
 * on one line. Asserting the note alone would pass on a row that had lost both.
 */
async function lineFor(page: Page, branch: string) {
  const link = page.locator(`[data-branch="${branch}"]`).first();
  await link.waitFor({ timeout: 15_000 });
  return link.evaluate((el) => {
    // The row is whichever ancestor carries the row's own cells. `li` is the
    // list item in a grouped fold and the row itself elsewhere, so the search
    // walks up to the first ancestor holding a note or a status rather than
    // assuming which wrapper this render used.
    let row: HTMLElement | null = el as HTMLElement;
    while (row && !row.querySelector('[data-row-note],[data-tuple-status]')) {
      row = row.parentElement;
    }
    const host = row ?? (el as HTMLElement);
    return {
      note: (host.querySelector('[data-row-note]') as HTMLElement | null)?.innerText.trim() ?? null,
      status: (host.querySelector('[data-tuple-status]') as HTMLElement | null)?.innerText.trim() ?? null,
      text: host.innerText.replace(/\n+/g, ' | '),
    };
  });
}

describe('a claimed slice does not say nobody took it', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  // The fleet is this file's own, for `slice-in-working.browser.test.ts`'s
  // reason: the subject is a wording decision on the client, so the payload has
  // to be the exact shape the server emits and `over` states it directly.
  async function open(): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet() },
      viewport: { width: 1480, height: 1400 },
    });
    await page.locator(`[data-branch="${FREE_BRANCH}"]`).first().waitFor({ timeout: 15_000 });
    return page;
  }

  it('a claimed branch does not offer itself', async () => {
    const page = await open();
    try {
      const line = await lineFor(page, CLAIMED_BRANCH);
      // THE DEFECT, as one property: the row must not say *nobody has taken it*
      // anywhere on it while its own startability says somebody has.
      expect(line.text).not.toContain('nobody has taken it');
      // AND THE FACT SURVIVES. Withdrawing the sentence must not cost the row
      // the answer — slot 5 carries it, which is why the note may go.
      expect(line.status).toBe(ON_IT);
    } finally {
      await page.close();
    }
  });

  it('a wip branch answers the same way — the other state on that line', async () => {
    const page = await open();
    try {
      const line = await lineFor(page, WIP_BRANCH);
      expect(line.text).not.toContain('nobody has taken it');
      expect(line.status).toBe(ON_IT);
    } finally {
      await page.close();
    }
  });

  it('the two states agree — one rule, not two', async () => {
    const page = await open();
    try {
      const claimed = await lineFor(page, CLAIMED_BRANCH);
      const wip = await lineFor(page, WIP_BRANCH);
      // `claimed` and `wip` reach `someone-is-on-it` by the same line of
      // `startabilityVerdict`, so a fix that treats them differently has read
      // the state rather than the verdict.
      expect(claimed.note).toBe(wip.note);
      expect(claimed.status).toBe(wip.status);
    } finally {
      await page.close();
    }
  });

  it('a genuinely unclaimed eligible branch keeps its sentence, word for word', async () => {
    const page = await open();
    try {
      const line = await lineFor(page, FREE_BRANCH);
      // THE CLIENT'S SPELLING, not the server's, and the difference is the
      // point. An `open` row is `isUnbegun`, so it renders as a SLICE HEAD and
      // takes the sentence from the `sliceNote` chain — *approved — …* —
      // where a claimed row renders through `Row` and carries the server's
      // *eligible — …*. Two producers for one sentence, which is why this
      // asserts what the row actually shows rather than the constant.
      //
      // WORD FOR WORD. This is the population the sentence is correct for; if
      // it goes red the fix is over-firing on work nobody has taken.
      expect(line.note).toBe('approved — nobody has taken it');
    } finally {
      await page.close();
    }
  });

  it('a null startability falls through to today\'s behaviour', async () => {
    const page = await open();
    try {
      const line = await lineFor(page, OLDER_BRANCH);
      // An older server's payload, or a merged branch. The gate is the ONE
      // verdict and not truthiness — `stateStatus`'s shape — so a row with no
      // startability answer renders exactly as it did before.
      expect(line.note).toBe(ELIGIBLE_NOTE);
    } finally {
      await page.close();
    }
  });
});
