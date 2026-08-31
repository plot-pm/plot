import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCatalogue, expandAgentFolds, row, wave, fleet, type Catalogue } from '../catalogue/index.js';
import { AgentRowSchema, FleetSchema } from '../../src/contract/schema.js';

/**
 * THE MOCK BOARD SERVES NAMED STATES — the catalogue's own tests.
 *
 * Three claims, one per line of the plan's branch entry:
 *
 *   1. a named state renders;
 *   2. an override changes only the named field;
 *   3. a schema field missing from the builder fails rather than rendering
 *      `undefined`.
 *
 * Plus the constraint the whole plan exists to satisfy: this file starts NO
 * board. The grep at the bottom asserts that of the catalogue's own source,
 * because "reuse the artifact, just point it at a fixture" is the shortcut that
 * reintroduces every cost the plan is about, and a comment cannot refuse it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

describe('the mock board serves named states', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('serves the page itself, so routing is real', async () => {
    const page = await cat.open('an-empty-estate');
    try {
      // A REAL ORIGIN, which is the whole reason this is a server rather than
      // the `setContent` harness `tuple-row.browser.test.ts` uses. Under
      // `setContent` the origin is `about:blank`, and the client's relative
      // `fetch('/api/board')` has no base to resolve against.
      expect(new URL(page.url()).protocol).toBe('http:');
      // The client MOUNTED — it fetched its payloads over that origin and
      // rendered. A page served without a working origin renders nothing.
      await page.locator('#root').waitFor({ timeout: 15_000 });
      expect(await page.locator('#root').innerHTML()).not.toBe('');
    } finally {
      await page.close();
    }
  });

  it('a test names a state and gets it', async () => {
    const page = await cat.open('a-done-wave', { tab: 'agents' });
    try {
      // DONE is folded by default, so the wave row is not in the DOM until the
      // section is opened. Asserting before this is how a correct fixture reads
      // as a missing one.
      await page.getByText('Done').first().waitFor({ timeout: 15_000 });
      const doneToggle = page.locator('[data-group-toggle]').filter({ hasText: 'Done' });
      if ((await doneToggle.getAttribute('aria-expanded')) === 'false') await doneToggle.click();

      const waveRow = page.locator('[data-wave-row="Complete"]');
      await waveRow.waitFor({ timeout: 10_000 });
      // The state is what its NAME says: a done wave of two merged branches,
      // whose own verdict is `complete`.
      const status = await waveRow.locator('[data-tuple-status]').textContent();
      expect(status).toMatch(/2\s+complete/);
    } finally {
      await page.close();
    }
  });

  it('an override changes only the field it names', async () => {
    // The SAME named state, with one row's branch renamed. Everything else about
    // `a-done-wave` — the count, the verdict word, the section — must be
    // unchanged, or the override is not an override but a second fixture.
    const base = await cat.open('a-done-wave', { tab: 'agents' });
    let baseStatus: string | null;
    try {
      await base.getByText('Done').first().waitFor({ timeout: 15_000 });
      const t = base.locator('[data-group-toggle]').filter({ hasText: 'Done' });
      if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
      baseStatus = await base.locator('[data-wave-row="Complete"] [data-tuple-status]')
        .textContent();
    } finally {
      await base.close();
    }

    const renamed = 'feature/renamed-by-the-override';
    const rows = [
      row({
        plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
        branch: renamed, wave: 'Complete', verdict: 'complete',
        branchUrl: `https://github.com/tiny/garden/tree/${renamed}`,
        state: 'merged', group: 'done', ageMinutes: 10,
      }),
      row({
        plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
        branch: 'feature/done-two', wave: 'Complete', verdict: 'complete',
        branchUrl: 'https://github.com/tiny/garden/tree/feature/done-two',
        state: 'merged', group: 'done', ageMinutes: 10,
      }),
    ];
    const page = await cat.open('a-done-wave', {
      tab: 'agents',
      over: {
        fleet: fleet({
          rows,
          waves: [wave({
            plan: 'six-waves', name: 'Complete', section: 'done',
            branches: [renamed, 'feature/done-two'],
            verdict: 'complete', complete: true,
          })],
        }),
      },
    });
    try {
      await page.getByText('Done').first().waitFor({ timeout: 15_000 });
      const t = page.locator('[data-group-toggle]').filter({ hasText: 'Done' });
      if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();

      const waveRow = page.locator('[data-wave-row="Complete"]');
      await waveRow.waitFor({ timeout: 10_000 });
      // CHANGED: the branch the override named. A wave's branches sit behind
      // two folds (plan, then wave), so this opens them the way the rest of the
      // suite does rather than reaching for one toggle by hand.
      await expandAgentFolds(page);
      await page.locator(`[data-branch="${renamed}"]`).first()
        .waitFor({ timeout: 10_000 });
      // UNCHANGED: everything the override did not name. Same wave, same count,
      // same verdict word — the override moved one branch name and nothing else.
      expect(await waveRow.locator('[data-tuple-status]').textContent()).toBe(baseStatus);
      expect(await page.locator('[data-branch="feature/done-two"]').count())
        .toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('starts no board — the artifact least of all', () => {
    // THE CONSTRAINT, asserted by grep over the catalogue's own source rather
    // than trusted to a comment. The failure mode this names is not "forgot to
    // mock" but "reused the real server pointed at a fixture", which a check for
    // `startServer` alone would pass.
    const dir = path.resolve(here, '../catalogue');
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      // Comments explain WHY the artifact is absent, so the grep reads code
      // only — otherwise this file's own explanation would fail it.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} must not spawn`).not.toMatch(/\bspawn\b/);
      expect(code, `${file} must not import the artifact`).not.toMatch(/board-server\.mjs/);
      expect(code, `${file} must not start a real board`).not.toMatch(/\bstartServer\b/);
    }
  });
});

/**
 * A SCHEMA FIELD THE BUILDER OMITS IS AN ERROR, NOT AN `undefined` RENDER.
 *
 * `Done when` item 4, and the whole correctness argument for the catalogue: the
 * client CASTS its payload, so a field a fixture omits reaches the renderer as
 * `undefined` rather than as a failure. These assert the two halves of the
 * guarantee that replaces that.
 *
 * The RUNTIME half is asserted here. The COMPILE-TIME half — a required field
 * the schema gains failing `tsc` on the builder's defaults — cannot be asserted
 * from inside a passing compile, and is gated instead by `test/catalogue` being
 * in `tsconfig.json`'s `include`. That inclusion is asserted below, because it
 * is the thing whose removal would silently retire the guarantee.
 */
describe('a field the builder omits fails rather than rendering undefined', () => {
  it('throws, naming the field, when a required field is missing', () => {
    // `state` has no default: a row without one is not a row. Built by hand
    // rather than through `row()`, because `row()` is what supplies it.
    expect(() => AgentRowSchema.parse({
      repo: 'garden', branch: 'feature/x', plan: 'a-plan', wave: 'w',
      group: 'working', ageMinutes: 1, note: '',
    })).toThrow(/state/);
  });

  it('throws on a value the schema does not admit', () => {
    // The bug this caught for real while the builder was being written:
    // `Approved` is a PLAN phase, and `AgentRow.phase` carries one of the five
    // BOARD phases. A cast accepts it and renders a column that does not exist.
    expect(() => row({ phase: 'Approved' as never })).toThrow(/phase/);
  });

  it('parses rather than casts, so a fleet with a bad row does not build', () => {
    expect(() => FleetSchema.parse({
      ...fleet(),
      rows: [{ repo: 'garden', branch: 'x' }],
    })).toThrow();
  });

  it('keeps test/catalogue inside the typecheck — the gate behind item 4', () => {
    // Without this, `pnpm run typecheck` never reads the builder and the
    // compile-time half of item 4 is a rule rather than a gate. Measured
    // 2026-08-30: `test/` was outside `include` entirely, and a deliberate type
    // error in it passed the typecheck silently.
    const tsconfig = JSON.parse(
      fs.readFileSync(path.resolve(here, '../../tsconfig.json'), 'utf8'),
    ) as { include: string[] };
    expect(tsconfig.include).toContain('test/catalogue');
  });
});
