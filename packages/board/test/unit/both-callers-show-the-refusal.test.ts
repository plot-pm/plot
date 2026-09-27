import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BOTH DISPATCH CALLERS SHOW THE SERVER'S SENTENCE.
 *
 * `2026-09-26-a-dispatch-does-not-hold-the-loop.md`. `/api/dispatch` refuses
 * with `{ok, slug, reason, detail}` and **never** sends `error`, so a caller
 * reading `body.error` alone renders a bare `HTTP 409` and throws the sentence
 * away. `StartWorkButton.tsx` was fixed on 2026-09-02; the row menu's Dispatch
 * entry was not, and nothing held the pair together — which is why this file
 * asserts BOTH rather than the one that was broken.
 *
 * It matters more since the wait moved off the event loop. The refusal never
 * reached the operator through the response before: the client aborts actions at
 * `ACTION_TIMEOUT_MS = 15_000` and a real `/plot-implement` takes minutes, so the
 * button got `Fetch is aborted`. Now the POST answers immediately, the refusals
 * it CAN return arrive, and these two are what display them.
 *
 * ## Why source rather than a browser
 *
 * The question is which field each caller reads FIRST, and the reading is one
 * expression in each. A browser test would have to serve a 409 carrying `detail`
 * and no `error` through two different controls to distinguish the fix from its
 * absence; this reads the expression. `start-work-refusal.browser.test.ts` owns
 * the part only a page can show.
 *
 * COMMENTS ARE STRIPPED, for `acting-spinner.test.ts`'s measured reason:
 * *"asserting over prose would make a docstring able to break the build, and
 * worse, able to satisfy it."* Both call sites carry a paragraph explaining this
 * very fix, so an un-stripped scan would pass on the comment while the code read
 * the wrong field.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const src = (rel: string) =>
  fs.readFileSync(path.resolve(here, '../../src/app', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The two callers of `POST /api/dispatch`, and there are exactly two. */
const CALLERS = [
  ['StartWorkButton', 'components/StartWorkButton.tsx'],
  ['the row menu Dispatch entry', 'lib/agent-rows/menus.tsx'],
] as const;

describe('both dispatch callers show the refusal detail', () => {
  it.each(CALLERS)('%s posts to /api/dispatch', (_name, rel) => {
    // The premise of every assertion below: if a caller stops calling the route,
    // its refusal handling is no longer this file's subject and the test must
    // say so rather than passing vacuously over a file that changed shape.
    expect(src(rel)).toContain("'/api/dispatch'");
  });

  it.each(CALLERS)('%s reads `detail` and prefers it over `error`', (_name, rel) => {
    const text = src(rel);
    expect(
      text,
      'the caller never reads `detail`, so a refusal renders as a bare status code. '
      + '`/api/dispatch` answers `{ok, slug, reason, detail}` and never `error`',
    ).toContain('detail');

    // THE ORDER IS THE FIX, not the presence. `body.error ?? body.detail` reads
    // `detail` and still shows nothing, because `error` is absent rather than
    // undefined-but-present — so the assertion is on which name comes first in
    // the fallback chain.
    const chain = /body\.(\w+)\s*\?\?\s*body\.(\w+)/.exec(text);
    expect(
      chain,
      'no `body.x ?? body.y` fallback found — the refusal is read some other way, '
      + 'and this test can no longer tell whether `detail` wins',
    ).not.toBeNull();
    expect(
      chain?.[1],
      `the caller reads \`body.${chain?.[1]}\` before \`body.${chain?.[2]}\`. `
      + '`detail` must come first: it is the field this endpoint actually sends, '
      + 'and reading `error` first rendered `HTTP 409` beside the button '
      + '(measured 2026-09-02 on StartWorkButton)',
    ).toBe('detail');
  });

  it('there are exactly two callers, so this file covers the population', () => {
    // A THIRD CALLER WOULD SILENTLY GO UNCHECKED. The defect was that one of two
    // callers got a fix; the same shape recurs the moment a third appears, so the
    // count is asserted rather than assumed.
    const appDir = path.resolve(here, '../../src/app');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          if (fs.readFileSync(full, 'utf8').includes("fetch('/api/dispatch'")) {
            found.push(path.relative(appDir, full));
          }
        }
      }
    };
    walk(appDir);
    expect(
      found.sort(),
      'the set of files posting to /api/dispatch changed. Add the new caller to '
      + 'CALLERS above — a caller that does not read `detail` shows `HTTP 409`',
    ).toEqual(CALLERS.map(([, rel]) => rel).sort());
  });
});
