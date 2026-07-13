# Board round-3: in-board plan viewer (`/plan/<file>` + modal)

**Date:** 2026-07-13
**Scope:** Render each plan as HTML from the board server and let a card open it —
in a modal *and* natively in a new tab — all landed in the existing board PR (#40).
**Branch:** `idea/kanban-board-v1` (PR #40)

## What shipped

1. **`GET /plan/<filename>`** (server): renders a plan file's markdown to a
   standalone, theme-aware HTML page.
2. **Card "Open" control**: a real anchor whose plain left-click opens an in-board
   modal (fetch + embed the rendered HTML in a sandboxed iframe), while
   modified/middle-clicks open the plan page natively in a new tab.
3. **Modal**: "Open in new tab" (same route) + "Close" (also Esc / backdrop).

## Markdown → HTML: `marked`, bundled

`marked` is a **devDependency**, not a runtime one — esbuild inlines it into
`board-server.mjs` exactly like react/zod, so the shipped artifact stays
dependency-free (no install step for adopters). Bundle grew ~626 KB → 672 KB.
`marked.parse(md, { async: false })` gives the synchronous string return under
TS strict. A leading YAML front-matter block is stripped before rendering (plans
mix front-matter and `## Status` styles; the raw `--- … ---` would otherwise
render as a stray rule + text).

## Path traversal: an allowlist, not a string filter

The security requirement was "only serve files under the plan dir." Rather than
sanitize `../` out of the path, `resolvePlanFile` matches the requested basename
against the set `collectPlanFiles` already walks (active/ → delivered/ → plan
root). A request therefore *cannot name* a file outside the plan dir — the guard
is structural. A leading `filename !== path.basename(filename)` check rejects any
separators up front.

**The verification trap (caught in review):** testing the guard with a raw
`GET /plan/../../CLAUDE.md` proves nothing — `new URL()` normalizes the `..`
segments *before the handler runs*, so the server sees `/CLAUDE.md`, which never
matches `/plan/` and 404s via the generic fallback; the board.ts guard is never
reached, yet the test goes green. The tests instead use inputs that actually
reach the guard:

- **`/plan/CLAUDE.md`** — the file genuinely exists and is readable in the fixture
  root, so a naive "read any file under repoRoot" implementation returns 200. It
  404s → proves a true allowlist. This is the primary assertion.
- **`/plan/..%2F..%2FCLAUDE.md`** — `%2F` survives URL parsing, so the handler
  decodes `../../CLAUDE.md` and the basename check rejects it. This exercises the
  guard directly.

## The Open control: real anchor, intercept only plain left-click

`PlanCard` renders `<a href="/plan/<basename>">Open</a>`. The `onClick` guard is
`if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;`
before `preventDefault()`. This preserves every native affordance — cmd/ctrl-click
(new tab), shift-click (window), middle-click (which fires `onAuxClick`, never
`onClick`, so it's untouched anyway). Only a plain primary click opens the modal.
This is the SPA-router `<Link>` pattern; the real `href` is what makes the native
paths work, so the browser test asserts it explicitly.

## Modal: fetch + embed in a sandboxed iframe

The requirement was "fetch + embed the rendered `/plan/<file>` HTML" — so the modal
`fetch()`es the route and sets the result as an `<iframe srcDoc>` (not `iframe
src`). srcdoc-from-fetch keeps the plan in its own isolated document: no Tailwind
preflight bleed into the plan's headings/lists, and `sandbox="allow-same-origin
allow-popups"` disables scripts (rendered markdown never needs JS — defense in
depth) while staying same-origin. One server response serves both the modal's
srcdoc and the new-tab full page.

## Tests — same layered, real-browser approach

- **Unit** (`test/unit/plan.test.ts`): `planHref` (repo-relative path → `/plan/`
  basename route, nesting, percent-encoding).
- **Data layer** (`test/integration/tiny-garden.plan.test.ts`): spawns the built
  artifact and hits `/plan/<file>` — asserts **real** markdown conversion (`##
  Approach` → `<h2>`, `- Brandywine` → `<li>`, the link → `<a href>`, the fenced
  block → `<pre>`), front-matter stripping, and the three 404 cases above.
- **UI layer** (`test/integration/tiny-garden.browser.test.ts`): the Open anchor's
  `href`; plain-click opens the modal and its iframe `srcdoc` is populated with the
  rendered plan; Close closes it; a **meta-click does not** open the modal; "Open
  in new tab" navigates a new page to the plan route.

**Why the browser test checks `srcdoc`, not the iframe's inner DOM.** The
requirement is "modal opens + closes" and "the new-tab path resolves" — not that
the iframe's DOM is asserted. Checking the iframe is visible and its `srcdoc`
attribute contains the rendered HTML proves the fetch+embed worked without
`frameLocator` frame-traversal (which a sandboxed frame complicates). Render
correctness lives in the data layer, where it's robust.

**Note on `expect`.** The browser suite imports `expect` from **vitest**, not
`@playwright/test`, so Playwright matchers (`toBeVisible`, `toHaveAttribute`)
aren't available — assertions use locator methods (`getAttribute`, `waitFor`) +
`expect.poll`, matching the existing round-2 tests.

**Fixture change.** `2026-03-01-plant-tomatoes.md` gained an `## Approach` section
(subheading, list, link, inline + fenced code) so the render assertions test a
genuine conversion rather than "the response contains some text." The `## Status`
block is unchanged, so plan-meta parsing and the board counts are unaffected.

## Refinements: modal chrome vs. full-page titlebar

A follow-up pass separated the two views' chrome:

- **Modal header** shows a static **"Plan"** label, not the plan's title. (The
  dialog's `aria-label` still carries the title for screen readers.)
- **Full-page view** (`/plan/<file>` opened in a new tab or hit directly) gains a
  sticky **titlebar with a "← Board" link (`href="/"`)** so you can navigate back.
- **The titlebar is suppressed in the modal** via a server-side query param: the
  modal's iframe fetches `/plan/<file>?embed=1`, and `renderPlanPage({ embed })`
  omits the titlebar element for that request. The *normal* links — the card's
  "Open" anchor and the modal's "Open in new tab" button — point at plain
  `/plan/<file>` (no param), so those full-page views keep the titlebar. The
  suppression is controlled purely by the param the modal injects; nothing else
  changes between the two renders.

**Test note.** The negative "no titlebar" assertions target the `<header
class="plan-titlebar">` *element*, not the string `plan-titlebar` — the `.plan-
titlebar` CSS rule lives in the always-present `<style>` block, so asserting on the
class name alone would false-fail. Data tests cover titlebar-present (plain) /
absent (`?embed=1`); the browser test asserts the modal header reads "Plan", the
embedded srcdoc has no titlebar element, and the new-tab full page's back link
`href="/"` actually navigates to the board.

## Verification

- Board `node:test` **8/8**; vitest **30/30** (10 unit + 12 data + 8 browser).
- `pnpm typecheck` clean; `pnpm test:reconcile` **37/37**.
- Artifact rebuilt (672.0 KB) and committed (CI freshness gate).
- CI needs no change: the new tests match the vitest `test/{unit,integration}`
  glob, and `marked` installs via `pnpm install` and bundles into the artifact.
- Both live preview servers restarted on the fresh artifact.

## Notes

- No `/api/board` schema change — the plan viewer is a separate route; cards
  already carry `path`, which is all the client needs to build the `/plan/` href.
- Board version left at `1.0.0-rc.1`: still one unreleased PR.
