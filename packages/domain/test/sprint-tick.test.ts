import { describe, expect, it } from 'vitest';

import { tickSprintItem } from '../src/rules/sprint-tick.js';

describe('tickSprintItem', () => {
  it('ticks the box on the line naming the slug', () => {
    const content = '- [ ] [a-plan] Do the thing';
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(true);
    expect(result.content).toBe('- [x] [a-plan] Do the thing');
  });

  it('touches nothing else on the line', () => {
    const content = '- [ ] [a-plan] Do the thing (Must, 3pts)';
    const result = tickSprintItem(content, 'a-plan');
    expect(result.content).toBe('- [x] [a-plan] Do the thing (Must, 3pts)');
  });

  it('leaves other lines untouched', () => {
    const content = ['- [ ] [other-plan] Something else', '- [ ] [a-plan] Do the thing'].join('\n');
    const result = tickSprintItem(content, 'a-plan');
    const lines = result.content.split('\n');
    expect(lines[0]).toBe('- [ ] [other-plan] Something else');
    expect(lines[1]).toBe('- [x] [a-plan] Do the thing');
  });

  it('reports changed: false when the slug is not found', () => {
    const content = '- [ ] [other-plan] Something else';
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('reports changed: false when the box is already ticked (idempotent)', () => {
    const content = '- [x] [a-plan] Do the thing';
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it('does not tick a different slug that is a substring', () => {
    const content = '- [ ] [a-plan-2] Do the other thing';
    const result = tickSprintItem(content, 'a-plan');
    expect(result.changed).toBe(false);
  });
});
