import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column,
  fleet as buildFleet, row as buildRow, type Catalogue,
} from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Card, type DraftPlan, type Fleet } from '../../src/contract/schema.js';

/**
 * A PLAN ROW NAMES ITS TICKET — the browser half. The label rule is asserted in
 * `test/unit/a-plan-row-names-its-ticket.test.ts`; this proves the shipped
 * artifact renders it on BOTH callers of `tupleFromPlan`, and that a payload
 * from an older server, which carries no `issues` field, renders the slug alone.
 */
const row = (plan: string): AgentRow => buildRow({
  repo: 'garden', branch: `feature/${plan}`, plan, planFile: `2026-09-30-${plan}.md`,
  wave: 'One', state: 'open', phase: 'Development', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
});

const PLANS: { slug: string; issues?: string[] }[] = [
  { slug: 'one-ticket', issues: ['1089'] },
  { slug: 'two-tickets', issues: ['1090', '1091'] },
  { slug: 'jira-ticket', issues: ['EWZKUS-3430'] },
  // An older server: the card carries no `issues` field at all.
  { slug: 'older-server' },
];

const cardOf = (p: { slug: string; issues?: string[] }): Card => {
  const built = buildCard({
    slug: p.slug, title: p.slug, type: 'feature', phase: 'Development',
    path: `docs/plans/2026-09-30-${p.slug}.md`, prs: [], phaseDate: '2026-09-30',
    ...(p.issues ? { issues: p.issues } : {}),
  });
  if (p.issues) return built;
  // The builder parses, and the parse fills the default; delete it to send
  // exactly what an older server sends.
  const { issues: _dropped, ...older } = built;
  return older as Card;
};

const DRAFTS = [
  { plan: 'drafted-ticket', planFile: '2026-09-30-drafted-ticket.md', title: 'Drafted', issues: ['1104'] },
  // An older server: the draft entry carries no `issues` field.
  { plan: 'drafted-older', planFile: '2026-09-30-drafted-older.md', title: 'Drafted older' },
] as DraftPlan[];

// The fleet builder parses too, so `drafted-older` arrives with `issues: []`
// filled in; drop it again to send what an older server sends.
const olderDraft = (fleet: Fleet): Fleet => ({
  ...fleet,
  draftPlans: fleet.draftPlans.map((d) => {
    if (d.plan !== 'drafted-older') return d;
    const { issues: _dropped, ...older } = d;
    return older as DraftPlan;
  }),
});

describe('a plan row names its ticket (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<{ page: Page; errors: string[] }> => {
    const page = await cat.open('an-empty-estate', {
      over: {
        board: buildBoard({ columns: [column({ phase: 'Development', cards: PLANS.map(cardOf) })] }),
        fleet: olderDraft(buildFleet({ rows: PLANS.map((p) => row(p.slug)), draftPlans: DRAFTS })),
      },
      tab: 'agents',
      viewport: { width: 1400, height: 1400 },
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { page, errors };
  };

  const planName = (page: Page, plan: string) =>
    page.locator(`li[data-plan-row="${plan}"] [data-tuple-link="plan"]`);
  const draftName = (page: Page, plan: string) =>
    page.locator(`[data-draft-plan-row="${plan}"] [data-tuple-link="plan"]`);

  it('prints the tracker keys before the slug on a plan row', async () => {
    const { page } = await open();
    try {
      await expect.poll(() => planName(page, 'one-ticket').count(), { timeout: 10_000 }).toBe(1);
      expect((await planName(page, 'one-ticket').textContent())?.trim()).toBe('1089: one-ticket');
      expect((await planName(page, 'two-tickets').textContent())?.trim()).toBe('1090, 1091: two-tickets');
      expect((await planName(page, 'jira-ticket').textContent())?.trim()).toBe('EWZKUS-3430: jira-ticket');
      // The prefix sits inside the plan link, and the link still opens the plan.
      expect(await planName(page, 'one-ticket').getAttribute('href')).toContain('2026-09-30-one-ticket.md');
    } finally { await page.close(); }
  });

  it('prints the prefix on a Draft plan row the same way', async () => {
    const { page } = await open();
    try {
      await expect.poll(() => draftName(page, 'drafted-ticket').count(), { timeout: 10_000 }).toBe(1);
      expect((await draftName(page, 'drafted-ticket').textContent())?.trim()).toBe('1104: drafted-ticket');
    } finally { await page.close(); }
  });

  it('renders the slug alone where the payload carries no issues field, and throws nothing', async () => {
    const { page, errors } = await open();
    try {
      await expect.poll(() => planName(page, 'older-server').count(), { timeout: 10_000 }).toBe(1);
      expect((await planName(page, 'older-server').textContent())?.trim()).toBe('older-server');
      await expect.poll(() => draftName(page, 'drafted-older').count(), { timeout: 10_000 }).toBe(1);
      expect((await draftName(page, 'drafted-older').textContent())?.trim()).toBe('drafted-older');
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
});
