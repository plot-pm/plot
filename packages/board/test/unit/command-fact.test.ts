// What the COMMAND field COLLAPSES to — the decision, asserted without a page.
//
// The panel renders the worker command, which on this fleet is ~1,400
// characters: the entire brief the agent was handed. The field now has a SIZE —
// three wrapped lines collapsed, a bounded scroller expanded — and this file
// owns the half of that which is a pure decision: what text the three lines
// wrap. The sizes themselves are geometry and are measured in a browser
// (`test/integration/command-copy.browser.test.ts`), because a clamp that did
// not clamp would pass every assertion a string can make.
//
// The rule this file pins: the preview is FLOWING TEXT — the brief's own
// newlines are collapsed so the browser, not the prose, decides where the three
// lines break — and it is LOSSLESS, so the full string is never mutated on the
// way to expand or clipboard. A collapse that dropped characters would make
// Copy yield "the truncated render", which is exactly the defect the wave
// removes.
import { describe, it, expect } from 'vitest';
import { commandFirstLine } from '../../src/app/components/AgentPanelFacts.js';

// A realistic worker command: the dispatcher launches `claude -p` with a prose
// brief that carries newlines. The collapsed preview must read as one line.
const REAL = [
  'PLOT_UNATTENDED=1 claude -p "You are implementing the branch $PLOT_BRANCH in',
  'this worktree, alone. Read .plot/briefs/the-command-can-be-read-in-full.md',
  'first — it is the specification." --permission-mode bypassPermissions',
].join('\n');

describe('the collapsed command is flowing text the browser wraps', () => {
  it('replaces the newlines that make a multi-line command with spaces', () => {
    // The brief's own line breaks are an artefact of how it was WRITTEN. Left
    // in, they would spend the three-line budget on two words and a break
    // before reaching the brief path — the very fact the reader opened this
    // for. Collapsed, the browser wraps the text and every line is full.
    const line = commandFirstLine(REAL);
    expect(line).not.toMatch(/\n/);
  });

  it('collapses runs of whitespace so the prose cannot force an early break', () => {
    // A tab or a run of spaces would render as a gap the wrap breaks at,
    // spending a line on whitespace.
    expect(commandFirstLine('claude  -p\t"x"')).toBe('claude -p "x"');
  });

  it('leaves an already-short single-line command untouched', () => {
    expect(commandFirstLine('pnpm board')).toBe('pnpm board');
  });

  it('preserves the brief path — the collapse loses no characters', () => {
    // The whole point: the reader who expands (or copies) gets the brief name,
    // which is the fact the truncated render buried. Collapsing whitespace must
    // not drop the substring the reader came for.
    expect(commandFirstLine(REAL)).toContain('.plot/briefs/the-command-can-be-read-in-full.md');
  });

  it('trims leading and trailing whitespace rather than showing a gap', () => {
    expect(commandFirstLine('  claude -p "x"  ')).toBe('claude -p "x"');
  });
});
