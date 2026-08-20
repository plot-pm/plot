import { describe, it, expect } from 'vitest';
import { toBoardPhase, BOARD_PHASES, PHASE_LEADERSHIP } from '../../src/contract/schema.js';
import { countChecklist } from '../../src/server/board.js';

describe('toBoardPhase', () => {
  it('reads Design as its own phase — design in progress, not an absence', () => {
    // The substantive change: Design is a real phase Plot has, not a state the
    // board infers from approved-and-unstarted. A plan in Design is one where a
    // question approval cannot answer still stands — a spike, a tracer bullet,
    // a spec against reality — and someone is doing that work.
    expect(toBoardPhase('design')).toBe('Design');
    // `started` must not move it either way: entering Design is a human act, and
    // a stray flag cannot promote design work out of its own column.
    expect(toBoardPhase('design', false)).toBe('Design');
    expect(toBoardPhase('design', true)).toBe('Design');
  });

  it('reads Approved as Development, started or not', () => {
    // The other half of the change: an approved plan is Development whether or
    // not a branch has started. Approved-but-unstarted is work waiting for an
    // agent — it belongs beside the Start button in Development, not in Design.
    // The measured case (three approved-unstarted plans) moves out of Design.
    expect(toBoardPhase('approved', false)).toBe('Development');
    expect(toBoardPhase('approved', true)).toBe('Development');
  });

  it('ends Development at the merge — Delivered is Endgame alone', () => {
    // A column is a partition. Delivered means the code landed and the agents
    // are done; verification and signoff are human-led.
    expect(toBoardPhase('delivered')).toBe('Endgame');
    expect(toBoardPhase('delivered', true)).toBe('Endgame');
  });

  it('reads Draft as Discovery — the phase where the plan is still being found', () => {
    // Draft IS the discovery phase: a plan under review is the investigation
    // deciding whether there is a commitment, and approval is where discovery
    // ends. Mapping it to Design put finished designs and unfinished ones in
    // one column, and left Discovery a column that could never hold anything.
    expect(toBoardPhase('draft')).toBe('Discovery');
    // `started` must not move it: a Draft plan has no Started: record, and a
    // stray flag must not promote one out of Discovery.
    expect(toBoardPhase('draft', true)).toBe('Discovery');
  });

  it('keeps Released in Released', () => {
    expect(toBoardPhase('released')).toBe('Released');
  });

  it('returns null for states the board does not render', () => {
    // Rejected/superseded/unknown plans must not silently land in a column.
    expect(toBoardPhase('rejected')).toBeNull();
    expect(toBoardPhase('')).toBeNull();
  });

  it('ignores a defaulted started flag — approved is Development regardless', () => {
    // `started` no longer forks the answer, so a caller that omits it lands in
    // the same column as one that passes either value. The parameter survives
    // only so the board and rowPhase compose one mapping.
    expect(toBoardPhase('approved')).toBe('Development');
  });

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
