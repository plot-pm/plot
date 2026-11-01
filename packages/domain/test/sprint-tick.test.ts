import { describe, expect, it } from 'vitest';

import { tickSprintItem } from '../src/rules/sprint-tick.js';

/** A Must Have tier line is what {@link memberLineIndex} requires to recognize a member line. */
const MUST = (line: string): string => `### Must Have\n\n${line}`;

describe('tickSprintItem', () => {
  it('ticks the box on the line naming the slug', () => {
    const content = MUST('- [ ] [a-plan] Do the thing');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(true);
    expect(result.content).toContain('- [x] [a-plan] Do the thing');
  });

  it('touches nothing else on the line', () => {
    const content = MUST('- [ ] [a-plan] Do the thing (Must, 3pts)');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.content).toContain('- [x] [a-plan] Do the thing (Must, 3pts)');
  });

  it('leaves other lines untouched', () => {
    const content = MUST(['- [ ] [other-plan] Something else', '- [ ] [a-plan] Do the thing'].join('\n'));
    const result = tickSprintItem(content, 'a-plan');
    const lines = result.content.split('\n');
    expect(lines).toContain('- [ ] [other-plan] Something else');
    expect(lines).toContain('- [x] [a-plan] Do the thing');
  });

  it('reports changed: false when the slug is not found', () => {
    const content = MUST('- [ ] [other-plan] Something else');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('reports changed: false when the box is already ticked (idempotent)', () => {
    const content = MUST('- [x] [a-plan] Do the thing');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('does not tick a different slug that is a substring', () => {
    const content = MUST('- [ ] [a-plan-2] Do the other thing');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
  });

  it('skips a line naming the slug outside a Must/Should/Could tier, e.g. a Scope Changes log line', () => {
    const content = [
      '### Scope Changes',
      '',
      '- 2026-10-29: Added [a-plan] by Jan Wloka',
      '',
      '### Must Have',
      '',
      '<!-- add items here -->',
    ].join('\n');
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });
});
