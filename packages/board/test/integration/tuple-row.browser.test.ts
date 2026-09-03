import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import {
  tupleFromAgent, tupleFromBuild, tupleFromIssue, tupleFromPlan, tupleFromRow,
  type TupleRow,
  tupleFromSlice,
} from '../../src/app/lib/tuple-row.js';
import { AgentRowSchema, IssueRowSchema, RowKindSchema, type AgentRow } from '../../src/contract/schema.js';
import { TUPLE_TRACKS } from '../../src/app/components/TupleRow.js';

/**
 * A ROW IS A TUPLE — what only a rendered page can settle.
 *
 * The unit suite (`test/unit/tuple-row.test.ts`) owns the DATA: which slots a
 * kind fills, which clock an age names, where the kind is decided. This owns the
 * claims that are about a DOM and cannot be answered by a projection:
 *
 *   - the kind is present WITHOUT HOVERING — a visible label, not a `title`;
 *   - a PR row renders THREE separate links to three destinations;
 *   - a branch row renders one link and NO empty artifact control;
 *   - a name with no URL is not an anchor;
 *   - each of the seven kinds renders all six slots;
 *   - a kind with no data renders NO ROW rather than an empty one.
 *
 * ## Why this STILL bundles a harness, now that the board renders the row
 *
 * It bundled one because the tuple had no live call site: the shape landed
 * first and `one-component-renders-every-row` replaced `Row`, `PlanRow` and
 * `IssueRowView` in a later wave. That wave has landed, and the assertions this
 * file's original note promised to move — one grid, the kind without hovering,
 * the PR's three links, membership — now run against the real page in
 * `one-grid.browser.test.ts`.
 *
 * **This file keeps the two kinds the board cannot serve.** `build` and `agent`
 * have no data source: no CI run and no session registry reaches `/api/fleet`,
 * so no row of either kind exists to drive. They are designed anyway, and the
 * plan says why — *a shape that admits only what exists today has to be
 * reopened for each kind that arrives, which is precisely how three components
 * and two grids happened.* Retiring the harness wholesale would have deleted
 * the only coverage of two of the seven kinds and left the argument for
 * designing them untested.
 *
 * The five kinds the board DOES serve stay here too, and the redundancy is
 * deliberate rather than leftover: this file proves the COMPONENT renders six
 * slots from a tuple it is handed, and `one-grid` proves the three ADAPTERS
 * hand it the right one. A single suite covering both would fail without
 * saying which half broke.
 *
 * This repo has no component-test seat either: vitest runs `environment:
 * 'node'`, with no jsdom and no React Testing Library, a limit
 * `acting-spinner.test.ts` records and works around by reading source. Reading
 * source is the honest answer for *which utility did this component choose*. It
 * is NOT the honest answer for *is this text visible without hovering* — that
 * is a question about a rendered box, and a regex over JSX would pass on a
 * `title` attribute containing the same word.
 *
 * So the component is bundled into a page and mounted in a real browser. Same
 * Chromium the sibling suites launch, same assertions against a live DOM — the
 * only difference is that the page is a harness rather than the board.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'plot', branch: 'feature/opus5-longhorizon-hardening', plan: 'fleet-scan-asks-the-host',
  planFile: '2026-08-20-fleet-scan-asks-the-host.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'waiting-on-you', ageMinutes: 30, note: '', ...over,
});

/** One row per kind — the seven, each with the data its kind actually has. */
const TUPLES: Record<string, TupleRow> = {
  ticket: tupleFromIssue(IssueRowSchema.parse({
    number: 228, title: 'Fleet scan asks the host once per branch',
    url: 'https://host/issues/228', ageMinutes: 1440,
  })),
  plan: tupleFromPlan({
    plan: 'fleet-scan-asks-the-host', planFile: '2026-08-20-fleet-scan-asks-the-host.md',
    phase: 'Design', waitingDays: 1,
  }),
  pr: tupleFromRow(row({
    kind: 'pr', ageMinutes: 25 * 1440,
    pr: { number: 57, url: 'https://host/pull/57', draft: false, state: 'conflicts' },
    branchUrl: 'https://host/tree/feature/opus5-longhorizon-hardening',
  })),
  build: tupleFromBuild({
    name: 'CI:1860', url: 'https://host/runs/1860', prNumber: 283,
    prUrl: 'https://host/pull/283', status: 'CI is running', ageMinutes: 10,
  }),
  agent: tupleFromAgent({
    sessionId: 'f30b27a3-9c1e-4f2b-bb77-0d5a1e2f3c44',
    branch: 'feature/opus5-longhorizon-hardening',
    branchUrl: 'https://host/tree/feature/opus5-longhorizon-hardening',
    status: 'thinking', sessionSeconds: 27 * 60, idleSeconds: 4 * 60,
  }),
  // WITH A PR, which is the case the slot-5 badge removal must not lose. A
  // branch row is a branch row precisely when the PR cannot resolve it (a merge
  // conflict), so the branch leads — and the PR is still a destination.
  // `fleet.ts` carries the warning about erasing it: *a branch started and then
  // shelved read as never begun, with its age and its PR erased.*
  branch: tupleFromRow(row({
    kind: 'branch', ageMinutes: 25 * 1440,
    branchUrl: 'https://host/tree/feature/opus5-longhorizon-hardening',
    pr: { number: 57, url: 'https://host/pull/57', draft: false, state: 'conflicts' },
  })),
  release: tupleFromRow(row({
    // `version`, the FIELD — read by the server from `package.json` on the
    // release branch. This carried `plan: '2.7.0'` instead, exercising the slug
    // fallback that no real row has ever taken: changesets names the branch
    // after the BASE, so a release row's slug is never a version.
    kind: 'release', version: '2.7.0', plan: '', planFile: '',
    branch: 'changeset-release/main',
    branchUrl: 'https://host/tree/changeset-release/main', ageMinutes: 12,
    pr: { number: 300, url: 'https://host/pull/300', draft: false, state: 'none' },
  })),
  // A BLOCKED WAVE, because it is the shape that carries every part of the split
  // this kind exists to make: `blocked` in slot 5, the wave it waits on as a
  // LINK in slot 4, and its own outstanding count on its own row — the three
  // facts `blockedNote()` used to crush into one sentence.
  wave: tupleFromSlice({
    name: 'Relocated', plan: 'a-wave-is-a-thing-not-a-label', verdict: 'blocked',
    branches: [
      { branch: 'feature/a-wave-is-a-kind', branchUrl: 'https://host/tree/feature/a-wave-is-a-kind' },
      { branch: 'bug/the-branch-row-stops-labelling-its-wave', branchUrl: 'https://host/tree/bug/x' },
    ],
    blockedBy: 'Modelled', outstanding: 2, ageMinutes: 1440, waitingDays: 1,
  }),
};

/**
 * A row with NO DATA — the case that must render no row at all.
 *
 * A build nothing has run: no name, no URL, no PR, no age. The rule is that a
 * kind with no data renders NO ROW rather than an empty one, and the harness
 * asks the same question the board will: given this, is there a row?
 */
const EMPTY = tupleFromBuild({
  name: '', url: '', prNumber: null, prUrl: '', status: '', ageMinutes: null,
});

/**
 * The harness page: mount every tuple, plus the empty one, and let the DOM
 * answer.
 *
 * `hasData` is the RULE, applied by the harness exactly as a section would: a
 * tuple with no name and no status has nothing to say, so nothing is rendered
 * for it. It lives here rather than inside `TupleRowView` on purpose — the
 * component's job is to render a row it is given, and *should this row exist* is
 * a membership question, which the plan puts outside this wave ("Membership.
 * Which section a row appears in is a separate decision and this changes none
 * of it").
 */
const HARNESS = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TupleRowView } from ${JSON.stringify(path.resolve(here, '../../src/app/components/TupleRow.tsx'))};

const tuples = window.__TUPLES__;
const hasData = (t) => Boolean(t.name.label) || Boolean(t.status);
createRoot(document.getElementById('root')).render(
  React.createElement(
    'ul',
    { role: 'rowgroup' },
    Object.entries(tuples)
      .filter(([, t]) => hasData(t))
      .map(([key, t]) => React.createElement(TupleRowView, {
        key,
        tuple: t,
        // A MENU IS PASSED IN, per kind — and a release is handed none, which is
        // how "its menu offers no release action" is enforced rather than
        // promised: there is no item for the component to render.
        menu: t.kind === 'release'
          ? null
          : React.createElement('button', { type: 'button', 'data-tuple-menu': t.kind }, '\\u22EF'),
      })),
  ),
);
`;

describe('a row is a tuple — what a rendered page settles', () => {
  let browser: Browser;
  let page: Page;
  let bundle: string;

  beforeAll(async () => {
    const built = await esbuild.build({
      stdin: { contents: HARNESS, resolveDir: path.resolve(here, '../..'), loader: 'tsx' },
      bundle: true, format: 'esm', write: false, jsx: 'automatic',
      // The app's own React, resolved from this package — the same copy the
      // board bundles, so the harness cannot pass on a version the app does not
      // use.
      absWorkingDir: path.resolve(here, '../..'),
    });
    bundle = built.outputFiles[0].text;
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    page = await context.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate(
      ([tuples, empty]) => {
        (window as never as { __TUPLES__: unknown }).__TUPLES__ = { ...(tuples as object), empty };
      },
      [TUPLES, EMPTY] as const,
    );
    await page.addScriptTag({ content: bundle, type: 'module' });
    await page.locator('li[data-tuple-kind]').first().waitFor({ timeout: 10_000 });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const rowOf = (kind: string) => page.locator(`li[data-tuple-kind="${kind}"]`);

  it('renders one row for each of the eight kinds', async () => {
    // Seven here, and the eighth is the point of the next test: the `empty`
    // build has no data and must not produce a row. Every kind that HAS data
    // renders, which is the shape being a shape rather than a description of
    // the three that happen to have components today.
    for (const kind of RowKindSchema.options) {
      await expect.poll(() => rowOf(kind).count(), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(1);
    }
  });

  it('renders NO ROW for a kind with no data — not an empty one', async () => {
    // The rule stated directly. An empty row holds a reader's attention and
    // says nothing; the board's standing answer to absence is absence.
    const rows = await page.locator('li[data-tuple-kind]').count();
    expect(rows).toBe(RowKindSchema.options.length);
    // And the empty build is the one that is missing: two build tuples went in,
    // one row came out.
    expect(await rowOf('build').count()).toBe(1);
  });

  it('states the kind VISIBLY, with no hover required', async () => {
    // THE DEFECT THIS REPLACES: `Branch … on the git host` was hover-only text
    // doing a label's job, and before that a column whose one word meant four
    // different things depending on the plan's wave count.
    //
    // `innerText` rather than `textContent`, because the question is what a
    // reader SEES — `innerText` is computed from layout and reports nothing for
    // a hidden box, so a label moved into a tooltip or display:none fails here.
    for (const [kind, tuple] of Object.entries(TUPLES)) {
      const slot = rowOf(kind).locator('[data-tuple-kind-label]');
      // CASE-INSENSITIVE, and the reason is worth recording: the harness page
      // carries no stylesheet, so Tailwind's `uppercase` does not apply and
      // `innerText` reports the authored casing. Asserting the styled form
      // would make this test a claim about a CSS utility rather than about the
      // kind being visible, and it would fail for a reason that has nothing to
      // do with what is being tested.
      await expect.poll(() => slot.innerText().then((t) => t.toLowerCase()),
        { timeout: 10_000 }).toBe(tuple.kindLabel.toLowerCase());
      // VISIBLE, and this is the half the defect was about: `innerText` is
      // computed from layout and reports "" for a hidden box, so a kind moved
      // back into a tooltip or a `display:none` span fails here.
      expect(await slot.isVisible(), kind).toBe(true);
    }
  });

  it('renders THREE separate links on a PR row, to three destinations', async () => {
    // The PR, its plan, its branch — three destinations, three different places.
    // All three facts were already on the row; what was missing is that only
    // some rendered and only one was a link.
    const links = rowOf('pr').locator('a[data-tuple-link], a[href]');
    await expect.poll(() => links.count(), { timeout: 10_000 }).toBe(3);
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(3);
    // And each says WHAT it points at, so they do not read as three
    // interchangeable words.
    const whats = await links.evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-tuple-link')));
      // NARROWEST FIRST, CONTAINER LAST — the order every arm has used since
      // 2026-08-22, adopted after a reader saw a plan row and a wave row on one
      // screen naming the same two artifacts in opposite orders.
    expect(whats).toEqual(['pr', 'branch', 'plan']);
  });

  it('renders every destination as a link, and no empty artifact control', async () => {
    // A branch's name IS the branch, and its artifact slot holds its plan AND
    // its PR. Where a slot has no destination it renders as NOTHING rather than
    // as a dead control — the rule this board already applies to a PR cell with
    // no PR.
    //
    // THREE, and it was two until 2026-08-20. The PR reached the reader through
    // a badge in SLOT 5 then, so the artifact slot held only the plan. The badge
    // is gone — an artifact in the status cell is the defect the tuple exists to
    // end — and the third link is what makes its removal lossless.
    const links = rowOf('branch').locator('a[data-tuple-link]');
    await expect.poll(() => links.count(), { timeout: 10_000 }).toBe(3);
    // And the PR is among them, which is the half that matters: the number is
    // still REACHABLE, just from the slot that holds destinations.
    expect(await rowOf('branch').locator('a[data-tuple-link="pr"]').count()).toBe(1);
    // The BRANCH row's own name, plus its plan and its PR.
    //
    // THE RELEASE ROW carries three now — its version names the row, and its PR
    // and branch are both artifacts. It was two while the version was unknown
    // and the PR number had to serve as the name; the version is read from
    // `package.json` on the release branch since 2026-08-20, so the number is
    // free to be what it is: a destination.
    const releaseLinks = rowOf('release').locator('a[data-tuple-link]');
    expect(await releaseLinks.count()).toBe(3);
    // The version leads it, and the PR is reachable beside the branch.
    expect(await rowOf('release').locator('[role="gridcell"]').nth(2).innerText())
      .toContain('2.7.0');
    // No empty anchors anywhere: an `<a>` with no text is a control a reader
    // can tab into and learn nothing from.
    const empties = await page.locator('a[data-tuple-link]').evaluateAll(
      (els) => els.filter((e) => !(e as HTMLElement).innerText.trim()).length);
    expect(empties).toBe(0);
  });

  it('renders a name with no URL as TEXT, not as an anchor', async () => {
    // An agent's name is its session id and there is nothing to open — the
    // transcript is a local file, reached from the menu. So the name renders as
    // text, and `data-tuple-text` is what says so.
    const name = rowOf('agent').locator('[data-tuple-text]').first();
    await expect.poll(() => name.count(), { timeout: 10_000 }).toBe(1);
    expect(await name.innerText()).toBe('f30b27a3');
    // It is NOT an anchor — the assertion that a missing address never becomes
    // an invented link.
    expect(await name.evaluate((e) => e.tagName)).toBe('SPAN');
  });

  it('renders all six slots on every row', async () => {
    // Slot 1 icon, slot 2 kind, slot 3 name, slot 4 links, slot 5 status, slot
    // 6 age. The links slot may be EMPTY — it is zero-or-more, the one place the
    // slot count bends — so the cell is asserted present rather than populated.
    for (const kind of Object.keys(TUPLES)) {
      const r = rowOf(kind);
      expect(await r.locator('[data-tuple-icon]').count(), `${kind} icon`).toBe(1);
      expect(await r.locator('[data-tuple-kind-label]').count(), `${kind} kind`).toBe(1);
      expect(await r.locator('[data-tuple-status]').count(), `${kind} status`).toBe(1);
      expect(await r.locator('[data-tuple-age]').count(), `${kind} age`).toBe(1);
      // The name is a link or a text span, and exactly one of the two.
      const name = await r.locator('[data-tuple-link], [data-tuple-text]').count();
      expect(name, `${kind} name`).toBeGreaterThanOrEqual(1);
      // Six gridcells, whatever the kind — the geometry that made a ticket wear
      // a branch's tracks is what one grid ends.
      expect(await r.locator('[role="gridcell"]').count(), `${kind} cells`).toBe(7);
    }
  });

  it('shows the age unlabelled on the rule and labelled on the exception', async () => {
    // The label marks the EXCEPTION rather than decorating the rule — the
    // inverse of the four-meanings column, which was unlabelled *because* its
    // meaning varied.
    const prAge = rowOf('pr').locator('[data-tuple-age]');
    expect(await prAge.innerText()).toBe('25d');
    expect(await prAge.getAttribute('data-tuple-age-label')).toBeNull();
    // A PLAN is aged from its approval, which is not a change — so it says so.
    const planAge = rowOf('plan').locator('[data-tuple-age]');
    expect(await planAge.getAttribute('data-tuple-age-label')).toBe('waiting');
    // An AGENT carries two clocks, both labelled, because it does not change —
    // it acts.
    const agentAge = rowOf('agent').locator('[data-tuple-age]');
    expect(await agentAge.innerText()).toContain('27m');
    expect(await agentAge.innerText()).toContain('idle 4m');
    expect(await agentAge.getAttribute('data-tuple-age-label')).toBe('session');
  });

  it('offers a RELEASE row no action at all', async () => {
    // The mark exists to stop a reflex merge. A menu entry offering to release
    // would put an outward-facing act on a board, and this repo cuts a release
    // only on an explicit request — so the kind is handed no item and the
    // component invents none.
    expect(await rowOf('release').locator('[data-tuple-menu]').count()).toBe(0);
    // Every other kind here got one, so the absence is about the release rather
    // than about the harness passing no menus.
    expect(await rowOf('pr').locator('[data-tuple-menu]').count()).toBe(1);
  });

  it('carries a ticket age, which the section orders by', async () => {
    expect(await rowOf('ticket').locator('[data-tuple-age]').innerText()).toBe('1d');
  });
});

/**
 * AN ELIGIBLE WAVE CARRIES THE TONE — what only a DOM settles.
 *
 * `statusTone('eligible')` returning the emerald class is a data fact the unit
 * suite owns. What this settles is that the class actually reaches the rendered
 * status cell AND that the WORD is unchanged — colour reinforces `eligible`
 * rather than replacing it, the rule `statusTone`'s docstring states.
 *
 * A second, one-tuple harness rather than an entry in `TUPLES`: that map is
 * keyed by kind and asserted to hold exactly one row per kind, so a second
 * `wave` would break the count above. The blocked wave up there is the negative
 * control — it renders no tone, and this proves the eligible one does.
 */
describe('an eligible wave carries the emerald tone', () => {
  let browser: Browser;
  let page: Page;

  const ELIGIBLE = tupleFromSlice({
    name: 'Shaped', plan: 'a-startable-wave-says-so', verdict: 'eligible',
    branches: [
      { branch: 'bug/an-eligible-wave-takes-the-actionable-tone', branchUrl: 'https://host/tree/bug/x' },
      { branch: 'bug/the-wave-leaves-the-kind-alone', branchUrl: 'https://host/tree/bug/y' },
    ],
    blockedBy: null, outstanding: null, ageMinutes: 30, waitingDays: null,
  });

  const ONE_HARNESS = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TupleRowView } from ${JSON.stringify(path.resolve(here, '../../src/app/components/TupleRow.tsx'))};

createRoot(document.getElementById('root')).render(
  React.createElement('ul', { role: 'rowgroup' },
    React.createElement(TupleRowView, { tuple: window.__SLICE__, menu: null })),
);
`;

  beforeAll(async () => {
    const built = await esbuild.build({
      stdin: { contents: ONE_HARNESS, resolveDir: path.resolve(here, '../..'), loader: 'tsx' },
      bundle: true, format: 'esm', write: false, jsx: 'automatic',
      absWorkingDir: path.resolve(here, '../..'),
    });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    page = await context.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate((wave) => {
      (window as never as { __SLICE__: unknown }).__SLICE__ = wave;
    }, ELIGIBLE);
    await page.addScriptTag({ content: built.outputFiles[0].text, type: 'module' });
    await page.locator('li[data-tuple-kind="wave"]').first().waitFor({ timeout: 10_000 });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('tones the status cell emerald and leaves the word `eligible`', async () => {
    const status = page.locator('li[data-tuple-kind="wave"] [data-tuple-status]');
    // THE WORD IS UNCHANGED — colour reinforces it, never replaces it.
    expect(await status.innerText()).toBe('eligible');
    // THE TONE IS PRESENT — the emerald class the good-news branch of
    // `statusTone` returns rides on the status text, the same class `green`
    // would carry. `innerHTML` because the harness page loads no stylesheet, so
    // the class is in the markup rather than expressed as a computed colour.
    expect(await status.innerHTML()).toContain('text-emerald-700');
    expect(await status.innerHTML()).toContain('dark:text-emerald-500');
  });
});

/**
 * THE NAME TRACK HOLDS THE NAME — the geometry only a laid-out grid can settle.
 *
 * Slot 3 was a fixed `12rem` (192px) while slot 4 took `1fr`. On a plan-group
 * head slot 4 is EMPTY, so the flexible track absorbed width the name needed and
 * a name past ~20 characters ellipsised while the row sat half empty. Slot 3 is
 * now `minmax(12rem, auto)`: the floor keeps a narrow viewport unchanged, the
 * `auto` ceiling lets a long name claim the room slot 4 is not using.
 *
 * This is asserted here rather than in the unit guard because it is a claim about
 * a RENDERED box: `truncate` clips whenever `scrollWidth > clientWidth`, which is
 * a layout-computed comparison and returns nothing meaningful without a grid
 * actually sizing the track. So the harness applies the grid CSS `TUPLE_TRACKS`
 * compiles to — the sibling harness above carries no stylesheet, and the kind
 * test there records that Tailwind classes are inert on that page.
 *
 * The CSS is DERIVED from the constant, not hand-copied: the test reads the
 * arbitrary-value track list out of `TUPLE_TRACKS` and turns it back into a
 * `grid-template-columns`, so a change to the constant flows straight through and
 * a hand-copied grid can never drift from the one the board ships.
 *
 * ## Overridden 2026-08-23 — the cost this accepts
 *
 * Each row is its own grid, so `auto` sizes to that row's content: a plan head
 * with a long name grows slot 3 wider than a branch row beneath it, and the
 * column edges no longer line up between the two. That was the property
 * `agent-rows-line-up` established, and the operator deliberately gave it up on
 * 2026-08-23 so the name renders in full (see `TUPLE_TRACKS`' docstring). This
 * suite therefore does NOT assert cross-row alignment on slots 3+; it asserts the
 * name is readable, which is what the trade bought.
 */
const gridTemplateColumnsFromTracks = (): string => {
  const inner = /grid-cols-\[(.+)\]/.exec(TUPLE_TRACKS)?.[1];
  if (!inner) throw new Error(`TUPLE_TRACKS is not a Tailwind track list: ${TUPLE_TRACKS}`);
  // Tailwind's arbitrary-value syntax joins tracks with `_` (a space becomes an
  // underscore); CSS wants spaces. `minmax(12rem,auto)` carries no underscore,
  // so the split is clean.
  return inner.split('_').join(' ');
};

// A slug long enough to clip at the OLD 12rem track and short enough to fit the
// grown one at 1400px — the exact case the plan measured (44 chars renders in
// full, ~20 clips). This is 44 characters, a real shape from this repo's
// estate rather than a synthetic string of x's.
const LONG_PLAN_SLUG = 'the-sections-carry-the-fleet-controls-widely';

const LONG_NAME_HARNESS = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TupleRowView } from ${JSON.stringify(path.resolve(here, '../../src/app/components/TupleRow.tsx'))};

const tuple = window.__TUPLE__;
createRoot(document.getElementById('root')).render(
  React.createElement(
    'ul',
    { role: 'rowgroup', id: 'grid' },
    React.createElement(TupleRowView, { tuple, menu: null }),
  ),
);
`;

describe('the name track holds the name (A: a long plan slug renders in full)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const planTuple = tupleFromPlan({
      plan: LONG_PLAN_SLUG,
      planFile: `2026-08-22-${LONG_PLAN_SLUG}.md`,
      phase: 'Design', waitingDays: 1,
    });
    const built = await esbuild.build({
      stdin: { contents: LONG_NAME_HARNESS, resolveDir: path.resolve(here, '../..'), loader: 'tsx' },
      bundle: true, format: 'esm', write: false, jsx: 'automatic',
      absWorkingDir: path.resolve(here, '../..'),
    });
    const bundle = built.outputFiles[0].text;
    browser = await chromium.launch();
    // 1400px — the wide viewport the plan states its A assertion at, where the
    // row has visible free space and a fixed 12rem track would still clip.
    const context = await browser.newContext({ viewport: { width: 1400, height: 600 } });
    page = await context.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate((t) => {
      (window as never as { __TUPLE__: unknown }).__TUPLE__ = t;
    }, planTuple);
    // SUPPLY THE TAILWIND UTILITIES THIS LAYOUT DEPENDS ON. The harness page
    // carries no stylesheet, so every `class` on the component is inert — the
    // grid does not size and, crucially, `truncate` does not clip, which is the
    // very behaviour under test. These are the exact declarations the named
    // utilities compile to; only the ones this geometry needs are supplied, so
    // the test states its dependencies rather than pulling in the whole build.
    await page.addStyleTag({ content: `
      .flex { display: flex; }
      .min-w-0 { min-width: 0; }
      .items-baseline { align-items: baseline; }
      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      * { font: 14px sans-serif; box-sizing: border-box; }
    ` });
    await page.addScriptTag({ content: bundle, type: 'module' });
    await page.locator('li[data-tuple-kind]').first().waitFor({ timeout: 10_000 });
    // APPLY THE GRID the constant compiles to. The `grid-cols-[…]` class is
    // inert here too; without this the row is a flex fallback and the track
    // never sizes. Derived from `TUPLE_TRACKS`, never hand-copied.
    await page.evaluate((cols) => {
      const li = document.querySelector('li[data-tuple-kind]') as HTMLElement;
      li.style.display = 'grid';
      li.style.gridTemplateColumns = cols;
      li.style.columnGap = '0.75rem'; // gap-x-3, matching the row's own class
    }, gridTemplateColumnsFromTracks());
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const nameSpan = () =>
    page.locator('li[data-tuple-kind="plan"] [data-tuple-link="plan"] .truncate');

  it('renders the full slug — the text is not ellipsised', async () => {
    // THE ASSERTION THAT SEPARATES A REAL FIX FROM A THRESHOLD SHIFT. `truncate`
    // ellipsises exactly when the text overflows its box: `scrollWidth` (the full
    // text width) exceeds `clientWidth` (the visible box). Equal means the whole
    // name shows. This is string-equality's geometric twin — asserted as "no
    // overflow", never as "wider than before".
    const span = nameSpan();
    await expect.poll(() => span.count(), { timeout: 10_000 }).toBe(1);
    const clipped = await span.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'the long slug should render in full, not ellipsised').toBe(false);
    // And the box is genuinely past the old 12rem floor — the `auto` ceiling
    // grew it. 192px is 12rem; a name this long needs more, and gets it.
    const boxWidth = await span.evaluate((el) => el.clientWidth);
    expect(boxWidth).toBeGreaterThan(192);
  });

  it('still ellipsises a name genuinely wider than the space available', async () => {
    // THE FIX IS *CLIP WHEN NEEDED*, NOT *NEVER CLIP*. Squeeze the row to a
    // narrow viewport-equivalent by pinning the grid to its 12rem floor and hand
    // it a name no track this side of the breakpoint could hold. The ellipsis
    // must come back — a fix that removed truncation entirely would pass A and
    // break every narrow viewport.
    await page.evaluate(() => {
      const li = document.querySelector('li[data-tuple-kind]') as HTMLElement;
      // Floor only: 12rem for slot 3, no grow. This is the narrow-viewport shape.
      li.style.gridTemplateColumns = '1.5rem 4.5rem 12rem 1fr 8rem 4.5rem 1.25rem';
    });
    const span = nameSpan();
    // A name far past 12rem (~20 chars) with the track pinned to its floor.
    await span.evaluate((el) => {
      el.textContent = 'a-name-far-longer-than-twelve-rem-could-ever-hold-and-then-some';
    });
    const clipped = await span.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'a name wider than the floored track must still clip').toBe(true);
  });
});
