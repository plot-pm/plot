import { describe, expect, it } from 'vitest';

import {
  checklistSummary,
  freshChecklist,
  hasRcLine,
  listsOnChecklist,
  renderChecklistEntry,
  withChecklistEntry,
  type ChecklistEntry,
} from '../src/rules/release-checklist.js';

const verified = (slug: string, tally: string): ChecklistEntry => ({
  slug,
  summary: `${slug} summary`,
  state: 'verified',
  tally,
  issue: null,
});

const refuted = (slug: string, issue: string | null): ChecklistEntry => ({
  slug,
  summary: `${slug} summary`,
  state: 'refuted',
  tally: '',
  issue,
});

describe('listsOnChecklist', () => {
  it('lists a Delivered feature plan and a Delivered bug plan', () => {
    expect(listsOnChecklist('feature', 'delivered')).toBe(true);
    expect(listsOnChecklist('bug', 'delivered')).toBe(true);
  });

  it('reads the type case-insensitively and ignores surrounding space', () => {
    expect(listsOnChecklist(' Feature ', 'delivered')).toBe(true);
  });

  it('leaves out a docs plan, an infra plan and a plan with no type', () => {
    expect(listsOnChecklist('docs', 'delivered')).toBe(false);
    expect(listsOnChecklist('infra', 'delivered')).toBe(false);
    expect(listsOnChecklist('', 'delivered')).toBe(false);
  });

  it('leaves out a Released plan and every other state', () => {
    expect(listsOnChecklist('feature', 'released')).toBe(false);
    expect(listsOnChecklist('bug', 'approved')).toBe(false);
    expect(listsOnChecklist('feature', 'none')).toBe(false);
  });
});

describe('hasRcLine', () => {
  it('is false for a bare checklist', () => {
    expect(hasRcLine(freshChecklist([verified('a', '2/2')]))).toBe(false);
  });

  it('is true once an RC: line exists', () => {
    expect(hasRcLine('# Release Checklist — v1.2.0\n\nRC: v1.2.0-rc.1 (2026-10-13)\n\n## Verification\n')).toBe(true);
  });

  it('ignores an RC: line inside a fenced block', () => {
    const text = '# Release Checklist\n\n```\nRC: v1.2.0-rc.1 (2026-10-13)\n```\n\n## Verification\n';
    expect(hasRcLine(text)).toBe(false);
  });
});

describe('checklistSummary', () => {
  it('joins a plan\'s Changelog entries with "; "', () => {
    const text = '# P\n\n## Changelog\n\n- one\n- two\n';
    expect(checklistSummary(text)).toBe('one; two');
  });

  it('is empty where the plan has no Changelog section', () => {
    expect(checklistSummary('# P\n\n## Status\n')).toBe('');
  });
});

describe('renderChecklistEntry', () => {
  it('renders a verified item with its tally', () => {
    expect(renderChecklistEntry(verified('the-plan', '3/3'))).toBe('- [ ] the-plan — the-plan summary — verified 3/3');
  });

  it('renders a refuted item with its issue', () => {
    expect(renderChecklistEntry(refuted('the-plan', '#1712'))).toBe('- [ ] the-plan — the-plan summary — refuted — #1712');
  });

  it('renders a refuted item with no issue yet', () => {
    expect(renderChecklistEntry(refuted('the-plan', null))).toBe('- [ ] the-plan — the-plan summary — refuted');
  });
});

describe('freshChecklist', () => {
  it('carries no RC: line', () => {
    expect(hasRcLine(freshChecklist([verified('a', '1/1')]))).toBe(false);
  });

  it('lists verified plans under Verification and omits an empty Refuted section', () => {
    const text = freshChecklist([verified('a', '1/1')]);
    expect(text).toContain('## Verification');
    expect(text).not.toContain('## Refuted');
    expect(text).toContain('- [ ] a — a summary — verified 1/1');
  });

  it('adds a Refuted section only when a plan refuted', () => {
    const text = freshChecklist([verified('a', '1/1'), refuted('b', '#9')]);
    expect(text).toContain('## Refuted');
    expect(text).toContain('- [ ] b — b summary — refuted — #9');
  });

  it('always writes empty sign-off lines', () => {
    const text = freshChecklist([verified('a', '1/1')]);
    expect(text).toContain('- [ ] All items verified by: ___');
    expect(text).toContain('- [ ] Final release approved by: ___');
  });

  it('counts total items including Automated Tests and Sign-off boxes', () => {
    // sanity: the file is parseable as plain checkbox lines, matching board.ts's countChecklist shape
    const lines = freshChecklist([verified('a', '1/1')]).split('\n').filter((l) => /^-\s+\[[ xX]\]/.test(l));
    expect(lines.length).toBe(4); // 1 verified + CI + 2 sign-off
  });
});

describe('withChecklistEntry', () => {
  it('inserts a new plan under Verification', () => {
    const base = freshChecklist([]);
    const next = withChecklistEntry(base, verified('a', '2/2'));
    expect(next).toContain('- [ ] a — a summary — verified 2/2');
  });

  it('updates an existing plan in place rather than duplicating it', () => {
    let text = freshChecklist([]);
    text = withChecklistEntry(text, verified('a', '1/2'));
    text = withChecklistEntry(text, verified('a', '2/2'));
    const matches = text.split('\n').filter((l) => l.includes('a — a summary'));
    expect(matches).toEqual(['- [ ] a — a summary — verified 2/2']);
  });

  it('moves a plan from Verification to Refuted on a refuted re-verify', () => {
    let text = freshChecklist([]);
    text = withChecklistEntry(text, verified('a', '2/2'));
    text = withChecklistEntry(text, refuted('a', '#42'));
    expect(text).not.toContain('— verified');
    expect(text).toContain('## Refuted');
    expect(text).toContain('- [ ] a — a summary — refuted — #42');
  });

  it('creates the Refuted heading on first use, after Verification', () => {
    const base = freshChecklist([verified('a', '1/1')]);
    expect(base).not.toContain('## Refuted');
    const next = withChecklistEntry(base, refuted('b', '#1'));
    const headings = next.split('\n').filter((l) => l.startsWith('## '));
    expect(headings.indexOf('## Verification')).toBeLessThan(headings.indexOf('## Refuted'));
    expect(headings.indexOf('## Refuted')).toBeLessThan(headings.indexOf('## Automated Tests'));
  });

  it('leaves Sign-off lines untouched across edits', () => {
    let text = freshChecklist([]);
    text = withChecklistEntry(text, verified('a', '1/1'));
    text = withChecklistEntry(text, refuted('b', null));
    expect(text).toContain('- [ ] All items verified by: ___');
    expect(text).toContain('- [ ] Final release approved by: ___');
  });

  it('appends a second plan in the same section without disturbing the first', () => {
    let text = freshChecklist([]);
    text = withChecklistEntry(text, verified('a', '1/1'));
    text = withChecklistEntry(text, verified('b', '2/2'));
    expect(text).toContain('- [ ] a — a summary — verified 1/1');
    expect(text).toContain('- [ ] b — b summary — verified 2/2');
  });

  it('never touches an RC: line, leaving the guard to the caller to check first', () => {
    const text = '# Release Checklist — v1.2.0\n\nRC: v1.2.0-rc.1 (2026-10-13)\n\n## Verification\n\n';
    const next = withChecklistEntry(text, verified('a', '1/1'));
    expect(next).toContain('RC: v1.2.0-rc.1 (2026-10-13)');
  });

  it('ignores a heading-shaped line inside a fenced block when locating a section', () => {
    const text = '# Release Checklist\n\n```\n## Verification\n- [ ] fenced — fenced summary — verified 1/1\n```\n\n## Verification\n\n';
    const next = withChecklistEntry(text, verified('a', '1/1'));
    const lines = next.split('\n');
    const fencedAt = lines.indexOf('```');
    expect(lines[fencedAt + 1]).toBe('## Verification');
    expect(next).toContain('- [ ] fenced — fenced summary — verified 1/1');
    const realHeadingAt = lines.lastIndexOf('## Verification');
    expect(lines[realHeadingAt + 1]).toBe('- [ ] a — a summary — verified 1/1');
  });

  it('ignores an item-shaped line inside a fenced block when removing a stale entry for the same slug', () => {
    const text =
      '# Release Checklist\n\n```\n- [ ] a — fenced summary — verified 9/9\n```\n\n## Verification\n\n- [ ] a — a summary — verified 1/1\n';
    const next = withChecklistEntry(text, verified('a', '2/2'));
    expect(next).toContain('- [ ] a — fenced summary — verified 9/9');
    expect(next).toContain('- [ ] a — a summary — verified 2/2');
    expect(next).not.toContain('- [ ] a — a summary — verified 1/1');
  });

  it('inserts at the top when neither the target heading nor Verification exists', () => {
    const text = '# Release Checklist\n\n## Automated Tests\n\n- [ ] CI passes on RC tag\n';
    const next = withChecklistEntry(text, verified('a', '1/1'));
    const lines = next.split('\n');
    expect(lines[0]).toBe('## Verification');
    expect(next.indexOf('## Verification')).toBeLessThan(next.indexOf('## Automated Tests'));
    expect(next).toContain('- [ ] a — a summary — verified 1/1');
  });
});
