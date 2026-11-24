import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LastFinish } from '@plot-pm/domain/entities/release-finish-record';
import { UnbookedRelease } from '../../src/app/components/UnbookedRelease.js';

/**
 * `UnbookedRelease` as markup: the row shows the line `unbookedReleaseRow`
 * decides. The wording and the null case are asserted in the domain's
 * `delivery-row-form.test.ts`.
 */
const render = (lastFinish: LastFinish | null): string =>
  renderToStaticMarkup(
    createElement(UnbookedRelease, {
      unbooked: { version: 'v2.36.0', plans: ['alpha'], sprintOpen: null },
      anchor: 'unbooked-v2.36.0',
      lastFinish,
    }),
  );

describe('UnbookedRelease', () => {
  it('shows the last finish\'s refusal reason in the row, and no line without one', () => {
    expect(render({ at: '2026-11-24T10:00:00.000Z', outcome: 'refused', reason: 'tag-absent' }))
      .toContain('<span data-testid="unbooked-last-finish">last finish: tag-absent</span>');
    expect(render(null)).not.toContain('unbooked-last-finish');
  });
});
