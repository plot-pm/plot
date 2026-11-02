import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planIndexOf } from '@plot-pm/domain';
import { IssueRowSchema } from '../../src/contract/schema.js';
import { IssueRowView } from '../../src/app/lib/agent-rows/rows.js';

const index = planIndexOf({
  cards: [{
    slug: 'two-test-teardowns-turn-main-red',
    title: 'Two test teardowns',
    path: 'docs/plans/2026-11-01-two-test-teardowns-turn-main-red.md',
    issues: ['3006'],
  }],
});

const render = (number: number, title: string): string =>
  renderToStaticMarkup(createElement(IssueRowView, {
    issue: IssueRowSchema.parse({ number, title }),
    idea: { available: false, reason: 'x' },
    story: { available: false, reason: 'x' },
    issueAnswer: null,
    planIndex: index,
  }));

describe('a ticket row names its plan', () => {
  it('a ticket whose plan exists shows the plan label and links to it', () => {
    const html = render(3006, 'Two test teardowns turn main red');
    expect(html).toContain('3006: two-test-teardowns-turn-main-red');
    expect(html).toContain('href="/plan/2026-11-01-two-test-teardowns-turn-main-red.md"');
  });

  it('a ticket with no plan shows its key and the inferred name as text, with no plan link', () => {
    const html = render(42, 'Something nobody planned');
    expect(html).toContain('42: ');
    expect(html).toContain('data-issue-name');
    expect(html).not.toContain('href="/plan/');
  });
});
