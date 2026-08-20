// What the COMMAND field COLLAPSES to — the decision, asserted without a page.
//
// The panel renders the worker command, which on this fleet is ~1,400
// characters: the entire brief the agent was handed. Truncated to one clipped
// line it stops inside `.plot/briefs/`, so the reader cannot even see which
// brief was named. The fix expands it and offers Copy — and the collapse is the
// one part that is a pure decision rather than a rendered interaction, so it is
// asserted here while the expand and the Copy are asserted in a browser
// (`test/integration/command-copy.browser.test.ts`).
//
// The rule this file pins: the collapsed form is ONE line, and it is a lossless
// preview — the full string is never mutated on the way to expand or clipboard.
// A collapse that dropped characters would make Copy yield "the truncated
// render", which is exactly the defect the wave removes.
import { describe, it, expect } from 'vitest';
import { commandFirstLine } from '../../src/app/components/AgentPanelFacts.js';

// A realistic worker command: the dispatcher launches `claude -p` with a prose
// brief that carries newlines. The collapsed preview must read as one line.
const REAL = [
  'PLOT_UNATTENDED=1 claude -p "You are implementing the branch $PLOT_BRANCH in',
  'this worktree, alone. Read .plot/briefs/the-command-can-be-read-in-full.md',
  'first — it is the specification." --permission-mode bypassPermissions',
].join('\n');

describe('the collapsed command is a single line', () => {
  it('replaces the newlines that make a multi-line command with spaces', () => {
    const line = commandFirstLine(REAL);
    expect(line).not.toMatch(/\n/);
  });

  it('collapses runs of whitespace so wrapping cannot reintroduce a break', () => {
    // A tab or a double space in the source must not survive as a place the
    // browser could break the "one line" into two.
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
