import { describe, it, expect } from 'vitest';
import { BOARD_PHASES, PHASE_LEADERSHIP } from '../../src/contract/schema.js';
import { countChecklist } from '../../src/server/board.js';

describe('PHASE_LEADERSHIP', () => {
  it('gives every column a leadership symbol AND word', () => {
    // Colour may only repeat these — one man in twelve distinguishes red from
    // green poorly, and the board turns up in greyscale screenshots.
    for (const phase of BOARD_PHASES) {
      expect(PHASE_LEADERSHIP[phase].icon).toBeTruthy();
      expect(PHASE_LEADERSHIP[phase].who).toBeTruthy();
    }
    expect(PHASE_LEADERSHIP.Development.who).toBe('agent-led');
    expect(PHASE_LEADERSHIP.Design.who).toBe('human-led');
  });
});

describe('countChecklist', () => {
  // A second contract surface — a markdown shape nothing else reads. It is
  // pinned completely because a wrong 15/27 looks exactly as authoritative as
  // a right one.

  it('counts done over total', () => {
    expect(countChecklist('- [x] a\n- [ ] b\n- [x] c')).toEqual({ done: 2, total: 3 });
  });

  it('accepts both list markers and either case of x', () => {
    expect(countChecklist('* [X] a\n- [x] b')).toEqual({ done: 2, total: 2 });
  });

  it('counts indented items — real checklists nest', () => {
    expect(countChecklist('- [x] a\n  - [ ] nested')).toEqual({ done: 1, total: 2 });
  });

  it('ignores prose that merely mentions brackets', () => {
    // "[ ]" inside a sentence is not a checklist item, and a line that starts
    // mid-text is not either.
    const text = 'See the [ ] notation.\nA line with - [x] in the middle.\n- [ ] real';
    expect(countChecklist(text)).toEqual({ done: 0, total: 1 });
  });

  it('ignores malformed items rather than guessing', () => {
    // No space after the box, a non-x marker, an empty box run together: each
    // is unparseable, and unparseable must not become a count.
    expect(countChecklist('- [x]nospace\n- [?] what\n- [] empty')).toBeNull();
  });

  it('returns null when there is no checklist at all', () => {
    // No badge beats a badge reading 0/0.
    expect(countChecklist('# Release\n\nNothing to check.')).toBeNull();
    expect(countChecklist('')).toBeNull();
  });
});
