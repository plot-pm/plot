import { describe, it, expect } from 'vitest';
import { annotateSprintItem } from '../src/rules/sprint-annotation.js';
import { withSprintAnnotation } from '../src/workflows/rendering.js';

/** A Must Have tier line is what {@link memberLineIndex} requires to recognize a member line. */
const MUST = (line: string): string => `### Must Have\n\n${line}\n`;

describe('annotateSprintItem on a file with a log line and a Deferred line', () => {
  it('updates the member line and leaves every other line identical', () => {
    const content = [
      '### Could Have', '', '- [ ] [slug] Thing', '', '## Notes', '', '### Scope Changes', '',
      '- 2026-11-01: added [slug] as Could', '', '### Deferred', '', '- [ ] [slug] Thing', '',
    ].join('\n');
    const { content: next, outcome } = annotateSprintItem(content, 'slug', 42, 'feature/x');
    expect(outcome).toBe('updated');
    const without = (text: string): string[] => text.split('\n').filter((_, i) => i !== 2);
    expect(without(next)).toEqual(without(content));
  });
});

describe('annotateSprintItem', () => {
  it('fills a comment-less item line with pr and branch', () => {
    const content = MUST('- [ ] [approve-me] the plan');
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toContain('- [ ] [approve-me] the plan <!-- pr: #42, branch: feature/alpha -->');
  });

  it('updates an existing pr/branch comment, preserving the closing marker exactly', () => {
    const content = MUST('- [ ] [approve-me] the plan <!-- pr: none, status: draft, branch: none -->');
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toMatch(/pr: #42/);
    expect(next).toMatch(/branch: feature\/alpha -->/);
    expect(next).not.toMatch(/status: approved/);
    // the untouched status field survives verbatim
    expect(next).toContain('status: draft');
  });

  it('never writes a status: key when filling a comment-less line', () => {
    const content = MUST('- [ ] [approve-me] the plan');
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(next).not.toMatch(/status:/);
  });

  it('a hyphenated branch name is not corrupted by the closing marker split', () => {
    const content = MUST('- [ ] [approve-me] the plan <!-- pr: none, branch: none -->');
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, 'bug/a-b');
    expect(next).toContain('branch: bug/a-b -->');
  });

  it('inserts pr into a comment that carries no pr field', () => {
    const content = MUST('- [ ] [approve-me] the plan <!-- status: draft -->');
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(outcome).toBe('updated');
    expect(next).toContain('<!-- pr: #42, status: draft -->');
  });

  it('appends branch to a comment that has pr and no branch field', () => {
    const content = MUST('- [ ] [approve-me] the plan <!-- pr: none -->');
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toContain('<!-- pr: #42, branch: feature/alpha -->');
  });

  it('closes a comment that was left open', () => {
    const content = MUST('- [ ] [approve-me] the plan <!-- pr: none, branch: none');
    const { content: next, outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('updated');
    expect(next).toContain('<!-- pr: #42, branch: feature/alpha -->');
  });

  it('a second run with the same pr/branch answers already, not updated', () => {
    const once = annotateSprintItem(MUST('- [ ] [approve-me] the plan'), 'approve-me', 42, 'feature/alpha');
    const twice = annotateSprintItem(once.content, 'approve-me', 42, 'feature/alpha');
    expect(twice.outcome).toBe('already');
    expect(twice.content).toBe(once.content);
  });

  it('a plan with no matching item line is missing, not an error', () => {
    const content = MUST('- [ ] [other-slug] something else');
    const { outcome } = annotateSprintItem(content, 'approve-me', 42, 'feature/alpha');
    expect(outcome).toBe('missing');
  });

  it('finds the item on a Must/Should/Could tier line, never on a log line naming the slug elsewhere', () => {
    const content = [
      '### Scope Changes',
      '',
      '- 2026-10-29: Added [approve-me] by Jan Wloka',
      '',
      '### Must Have',
      '',
      '<!-- add items here -->',
    ].join('\n');
    const { outcome } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(outcome).toBe('missing');
  });

  it('an empty branch leaves the branch field untouched on a fresh line', () => {
    const content = MUST('- [ ] [approve-me] the plan');
    const { content: next } = annotateSprintItem(content, 'approve-me', 42, '');
    expect(next).toContain('<!-- pr: #42 -->');
    expect(next).not.toMatch(/branch:/);
  });
});

describe('annotateSprintItem with no plan PR read', () => {
  it('writes pr: none on a bare line', () => {
    const { content, outcome } = annotateSprintItem(MUST('- [ ] [slug] the plan'), 'slug', null, 'x');
    expect(outcome).toBe('updated');
    expect(content).toContain('- [ ] [slug] the plan <!-- pr: none, branch: x -->');
  });

  it('rewrites pr: #0 to pr: none', () => {
    const { content, outcome } = annotateSprintItem(MUST('- [ ] [slug] the plan <!-- pr: #0, branch: x -->'), 'slug', null, 'x');
    expect(outcome).toBe('updated');
    expect(content).toContain('- [ ] [slug] the plan <!-- pr: none, branch: x -->');
  });

  it('keeps a pr key that names a real PR', () => {
    const line = '- [ ] [slug] the plan <!-- pr: #12, branch: x -->';
    const { content, outcome } = annotateSprintItem(MUST(line), 'slug', null, 'x');
    expect(outcome).toBe('already');
    expect(content).toContain(line);
  });

  it('inserts pr: none into a comment with no pr key', () => {
    const { content } = annotateSprintItem(MUST('- [ ] [slug] the plan <!-- branch: x -->'), 'slug', null, 'x');
    expect(content).toContain('<!-- pr: none, branch: x -->');
  });

  it('a number still writes pr: #n over pr: #0', () => {
    const { content } = annotateSprintItem(MUST('- [ ] [slug] the plan <!-- pr: #0, branch: x -->'), 'slug', 7, 'x');
    expect(content).toContain('<!-- pr: #7, branch: x -->');
  });

  it('a missing member line answers missing', () => {
    expect(annotateSprintItem(MUST('- [ ] [other] else'), 'slug', null, 'x').outcome).toBe('missing');
  });
});

describe('withSprintAnnotation on an empty comment', () => {
  it('writes the pr key with no stray comma', () => {
    const { text } = withSprintAnnotation(MUST('- [ ] [slug] the plan <!-- -->'), 'slug', false, 42, '');
    expect(text).toContain('- [ ] [slug] the plan <!-- pr: #42 -->');
  });

  it('writes the branch key with no stray comma', () => {
    const { text } = withSprintAnnotation(MUST('- [ ] [slug] the plan <!-- -->'), 'slug', false, null, 'x');
    expect(text).toContain('- [ ] [slug] the plan <!-- branch: x -->');
  });
});

describe('withSprintAnnotation with pr null', () => {
  it('leaves an existing pr: #0 as it is', () => {
    const text = MUST('- [ ] [slug] the plan <!-- pr: #0, branch: x -->');
    expect(withSprintAnnotation(text, 'slug', false, null, 'x')).toEqual({ text, wrote: false });
  });
});

describe('annotateSprintItem agrees with withSprintAnnotation', () => {
  const lines = [
    '- [ ] [slug] the plan',
    '- [ ] [slug] the plan <!-- pr: none, status: draft, branch: none -->',
    '- [ ] [slug] the plan <!-- status: draft -->',
    '- [ ] [slug] the plan <!-- pr: none -->',
    '- [ ] [slug] the plan <!-- pr: none, branch: none',
    '- [ ] [slug] the plan <!-- pr: #0, branch: feature/old -->',
    '- [ ] [slug] the plan <!-- pr: #12, branch: bug/a-b -->',
    '- [x] [slug] the plan <!-- pr: #12 -->',
  ];
  const inputs: [number | null, string][] = [[42, 'feature/alpha'], [42, ''], [null, 'bug/a-b'], [null, '']];

  for (const line of lines) {
    for (const [pr, branch] of inputs) {
      it(`${line} with pr ${String(pr)} and branch '${branch}'`, () => {
        const text = MUST(line);
        const rule = annotateSprintItem(text, 'slug', pr, branch);
        const written = withSprintAnnotation(text, 'slug', false, pr ?? 'none', branch);
        expect(rule.content).toBe(written.text);
        expect(rule.outcome).toBe(written.wrote ? 'updated' : 'already');
      });
    }
  }
});
