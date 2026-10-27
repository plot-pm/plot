import { describe, expect, it } from 'vitest';

import { flipFrontMatterPhase, flipStatusValue, insertStatusRecord, reverseDelivery } from '../src/rules/plan-record-edit.js';

describe('flipStatusValue', () => {
  it('flips State: Approved to Delivered inside ## Status', () => {
    const content = ['## Status', '', '- **State:** Approved', '', '## Design'].join('\n');
    const result = flipStatusValue(content, 'approved', 'Delivered');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('- **State:** Delivered');
  });

  it('flips Phase: for a plan written before the State rename', () => {
    const content = ['## Status', '', '- **Phase:** Approved', '', '## Design'].join('\n');
    const result = flipStatusValue(content, 'approved', 'Delivered');
    expect(result.content).toContain('- **Phase:** Delivered');
  });

  it('does not touch a State: line outside ## Status', () => {
    const content = [
      '## Design',
      '- **State:** Approved',
      '## Status',
      '- **State:** Approved',
    ].join('\n');
    const result = flipStatusValue(content, 'approved', 'Delivered');
    const lines = result.content.split('\n');
    expect(lines[1]).toBe('- **State:** Approved');
    expect(lines[3]).toBe('- **State:** Delivered');
  });

  it('reports changed: false and leaves the file identical when nothing matches', () => {
    const content = ['## Status', '- **State:** Delivered'].join('\n');
    const result = flipStatusValue(content, 'approved', 'Delivered');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('is idempotent: a plan already at the target value flips nothing', () => {
    const content = ['## Status', '- **State:** Delivered'].join('\n');
    const result = flipStatusValue(content, 'approved', 'Delivered');
    expect(result.changed).toBe(false);
  });
});

describe('flipFrontMatterPhase', () => {
  it('flips both status: and phase: when both are present (#2439)', () => {
    const content = ['---', 'status: Approved', 'phase: Approved', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('status: Delivered');
    expect(result.content).toContain('phase: Delivered');
  });

  it('flips status: alone when phase: is absent', () => {
    const content = ['---', 'status: Approved', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('status: Delivered');
  });

  it('flips phase: alone when status: is absent', () => {
    const content = ['---', 'phase: Approved', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('phase: Delivered');
  });

  it('leaves the file untouched when there is no front matter (absent is not false)', () => {
    const content = ['# A plan', '', '## Status', '- **State:** Approved'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('does not touch a status:/phase: line outside the leading front-matter block', () => {
    const content = [
      '# A plan',
      '',
      'status: Approved',
      '',
      '## Status',
      '- **State:** Approved',
    ].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('is idempotent: front matter already at the target value flips nothing', () => {
    const content = ['---', 'status: Delivered', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('touches only the first occurrence of each key', () => {
    const content = ['---', 'status: Approved', 'status: Approved', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    const lines = result.content.split('\n');
    expect(lines[1]).toBe('status: Delivered');
    expect(lines[2]).toBe('status: Approved');
  });

  it('skips a front-matter line that is neither status: nor phase:', () => {
    const content = ['---', 'type: bug', 'status: Approved', '---', '', '# A plan'].join('\n');
    const result = flipFrontMatterPhase(content, 'approved', 'Delivered');
    expect(result.changed).toBe(true);
    const lines = result.content.split('\n');
    expect(lines[1]).toBe('type: bug');
    expect(lines[2]).toBe('status: Delivered');
  });
});

describe('insertStatusRecord', () => {
  it('fills an empty placeholder first', () => {
    const content = [
      '## Status',
      '- **State:** Delivered',
      '- **Delivered:**',
      '## Design',
    ].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('- **Delivered:** 2026-10-04');
    expect(result.content.split('\n').filter((l) => l.includes('**Delivered:**'))).toHaveLength(1);
  });

  it('appends after the last list item when there is no placeholder', () => {
    const content = ['## Status', '- **State:** Delivered', '- **Approved:** 2026-09-01, jwloka', '## Design'].join(
      '\n',
    );
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    const lines = result.content.split('\n');
    expect(lines[2]).toBe('- **Approved:** 2026-09-01, jwloka');
    expect(lines[3]).toBe('- **Delivered:** 2026-10-04');
    expect(lines[4]).toBe('## Design');
  });

  // THE 2026-09-01 BUG: a `Started:` record block sits inside an HTML comment
  // at the end of `## Status`. A scan that tracks "the last list item seen"
  // without watching for the comment walks INTO it and appends there — written
  // but invisible to the parser, and idempotent re-runs kept appending a
  // second line inside the same comment.
  it('stops at an HTML comment rather than inserting inside it', () => {
    const content = [
      '## Status',
      '- **State:** Delivered',
      '- **Approved:** 2026-09-01, jwloka',
      '<!-- Transition records — written by the workflow commands, not by hand:',
      '- **Started:** 2026-09-01, jwloka, infra/x',
      '-->',
      '## Design',
    ].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    const lines = result.content.split('\n');
    // Inserted right after the last real list item, BEFORE the comment opens.
    expect(lines[2]).toBe('- **Approved:** 2026-09-01, jwloka');
    expect(lines[3]).toBe('- **Delivered:** 2026-10-04');
    expect(lines[4]).toBe('<!-- Transition records — written by the workflow commands, not by hand:');
    // The comment's content is untouched — no second record landed inside it.
    expect(result.content).not.toContain('- **Delivered:** 2026-10-04\n- **Started:**');
    expect(
      result.content.split('\n').filter((l) => l.includes('**Delivered:**')),
    ).toHaveLength(1);
  });

  // A commented-out placeholder must not be mistaken for the slot to fill —
  // the comment check runs BEFORE the placeholder test.
  it('does not fill a placeholder that sits inside the HTML comment', () => {
    const content = [
      '## Status',
      '- **State:** Delivered',
      '- **Approved:** 2026-09-01, jwloka',
      '<!--',
      '- **Delivered:**',
      '-->',
      '## Design',
    ].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    const lines = result.content.split('\n');
    expect(lines[3]).toBe('- **Delivered:** 2026-10-04');
    // The placeholder inside the comment remains untouched.
    expect(result.content).toContain('<!--\n- **Delivered:**\n-->');
  });

  it('leaves the file byte-identical when there is no ## Status section', () => {
    const content = ['## Design', 'no status section here'].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('inserts after the last list item, not after a blank line that follows it', () => {
    const content = ['## Status', '', '- **State:** Approved', '', '## Design'].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    expect(result.content.split('\n')).toEqual([
      '## Status',
      '',
      '- **State:** Approved',
      '- **Delivered:** 2026-10-04',
      '',
      '## Design',
    ]);
  });

  it('inserts at the end of ## Status when the section has no comment and no placeholder', () => {
    const content = ['## Status', '- **State:** Approved'].join('\n');
    const result = insertStatusRecord(content, 'Delivered', '2026-10-04');
    expect(result.content.split('\n')).toEqual([
      '## Status',
      '- **State:** Approved',
      '- **Delivered:** 2026-10-04',
    ]);
  });
});

describe('reverseDelivery', () => {
  const plan = (status: string, front = '') =>
    `${front}# P\n\n## Status\n\n${status}\n## Changelog\n\n- x\n`;

  it('flips the state and inserts Rejected: directly after it', () => {
    const out = reverseDelivery(
      plan('- **State:** Delivered\n- **Approved:** a\n- **Delivered:** d\n'),
      'Approved',
      '2026-01-03, why',
    );
    expect(out).toContain('- **State:** Approved\n- **Rejected:** 2026-01-03, why\n- **Approved:** a');
  });

  it('replaces an existing Rejected: line rather than adding a second', () => {
    const out = reverseDelivery(
      plan('- **State:** Delivered\n- **Rejected:** old\n'),
      'Approved',
      'new',
    );
    expect(out).toContain('- **Rejected:** new');
    expect(out?.match(/Rejected:/g)).toHaveLength(1);
  });

  it('flips the first status: and phase: front-matter keys and keeps the quotes', () => {
    const out = reverseDelivery(
      plan('- **State:** Delivered\n', '---\nstatus: "Delivered"\nphase: Delivered\n---\n'),
      'Approved',
      'r',
    );
    expect(out).toContain('status: "Approved"\nphase: Approved\n---');
  });

  it('returns null where the status section holds no state bullet', () => {
    expect(reverseDelivery(plan('- **Approved:** a\n'), 'Approved', 'r')).toBeNull();
  });
});
