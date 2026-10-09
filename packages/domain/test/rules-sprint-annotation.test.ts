import { describe, it, expect } from 'vitest';
import { annotateSprintItem } from '../src/rules/sprint-annotation.js';

describe('annotateSprintItem', () => {
  it('fills a comment-less item line with pr and branch', () => {
    const content = '# Sprint\n\n## Must\n\n- [ ] [approve-me] the plan\n';
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toContain('- [ ] [approve-me] the plan <!-- pr: #42, branch: feature/alpha -->');
  });

  it('updates an existing pr/branch comment, preserving the closing marker exactly', () => {
    const content = '- [ ] [approve-me] the plan <!-- pr: none, status: draft, branch: none -->\n';
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toMatch(/pr: #42/);
    expect(next).toMatch(/branch: feature\/alpha -->/);
    expect(next).not.toMatch(/status: approved/);
    // the untouched status field survives verbatim
    expect(next).toContain('status: draft');
  });

  it('never writes a status: key when filling a comment-less line', () => {
    const content = '- [ ] [approve-me] the plan\n';
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(next).not.toMatch(/status:/);
  });

  it('a hyphenated branch name is not corrupted by the closing marker split', () => {
    const content = '- [ ] [approve-me] the plan <!-- pr: none, branch: none -->\n';
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, 'bug/a-b');
    expect(next).toContain('branch: bug/a-b -->');
  });

  it('inserts pr into a comment that carries no pr field', () => {
    const content = '- [ ] [approve-me] the plan <!-- status: draft -->\n';
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(outcome).toBe('updated');
    expect(next).toContain('<!-- pr: #42, status: draft -->');
  });

  it('appends branch to a comment that has pr and no branch field', () => {
    const content = '- [ ] [approve-me] the plan <!-- pr: none -->\n';
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toContain('<!-- pr: #42, branch: feature/alpha -->');
  });

  it('a second run with the same pr/branch answers already, not updated', () => {
    const once = annotateSprintItem('- [ ] [approve-me] the plan\n', 'approve-me', 42, 'feature/alpha');
    const twice = annotateSprintItem(once.content, 'approve-me', 42, 'feature/alpha');
    expect(twice.outcome).toBe('already');
    expect(twice.content).toBe(once.content);
  });

  it('a plan with no matching item line is missing, not an error', () => {
    const content = '- [ ] [other-slug] something else\n';
    const { outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('missing');
  });

  it('finds the item by [slug] content, not by position or heading', () => {
    const content = '## Should\n\n- [ ] [approve-me] buried under the wrong heading\n';
    const { outcome } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(outcome).toBe('updated');
  });

  it('an empty branch leaves the branch field untouched on a fresh line', () => {
    const content = '- [ ] [approve-me] the plan\n';
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(next).toContain('<!-- pr: #42 -->');
    expect(next).not.toMatch(/branch:/);
  });
});
