import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_DROP_HEADING,
  backgroundDropCorrection,
  droppedBackgroundLine,
} from '../src/rules/background-drop.js';
import { HARNESS_LIMIT_LINES } from '../src/adapters/harness/limit-lines.js';
import { promptExit, type PromptExitInput } from '../src/rules/prompt-exit.js';

/** The line `claude -p` 2.1.291 wrote on 2026-10-06 (#1322), verbatim. */
const TERMINATED =
  'Background tasks still running after 600s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.';
/** The closing line of the second #1322 turn, verbatim. */
const MONITOR = "I'll pause further polling and wait for the Monitor's notification before taking the next action.";
const PREFIX = HARNESS_LIMIT_LINES.claude!.dropped;

describe('droppedBackgroundLine', () => {
  it('finds the termination line anywhere in the output', () => {
    expect(droppedBackgroundLine(['work', TERMINATED, 'Done: PR #12 opened.'].join('\n'), PREFIX)).toBe(TERMINATED);
  });

  it('reads a quoted termination line as no drop', () => {
    expect(droppedBackgroundLine(`The issue quoted \`${TERMINATED}\`.`, PREFIX)).toBeUndefined();
    expect(droppedBackgroundLine(`> ${TERMINATED}`, PREFIX)).toBeUndefined();
  });

  it('reads no termination line without a harness prefix', () => {
    expect(droppedBackgroundLine(TERMINATED, undefined)).toBeUndefined();
    expect(droppedBackgroundLine(TERMINATED, '')).toBeUndefined();
  });

  it('finds a closing line that waits for a Monitor notification', () => {
    expect(droppedBackgroundLine(['Pushed 2 commits.', MONITOR].join('\n'), PREFIX)).toBe(MONITOR);
  });

  it.each([
    "I'm waiting for the background agent to finish the docs.",
    'Waiting for the background build to complete.',
    'Let me wait for the notification before I open the PR.',
  ])('finds the waiting line %j', (line) => {
    expect(droppedBackgroundLine(line, undefined)).toBe(line);
  });

  it.each([
    'I did not wait for background tasks; every test ran in the foreground.',
    "I'm not waiting for any background task.",
    'PR #12 is open. The checks run in CI and a correction comes back if they fail.',
  ])('reads %j as a finished turn', (line) => {
    expect(droppedBackgroundLine(line, PREFIX)).toBeUndefined();
  });

  it('reads only the closing lines for the waiting shape', () => {
    const output = [MONITOR, 'then I stopped polling', 'a', 'b', 'c', 'd', 'Report: PR #12.'].join('\n');
    expect(droppedBackgroundLine(output, PREFIX)).toBeUndefined();
  });
});

describe('backgroundDropCorrection', () => {
  it('opens with the heading and names the line', () => {
    const text = backgroundDropCorrection(TERMINATED);
    expect(text.startsWith(`${BACKGROUND_DROP_HEADING}\n\n`)).toBe(true);
    expect(text).toContain(TERMINATED);
    expect(text).toContain('FOREGROUND');
  });
});

describe('promptExit — a turn that dropped its background work', () => {
  const input = (over: Partial<PromptExitInput>): PromptExitInput => ({
    status: 0,
    output: '',
    now: 0,
    boundSeconds: 28800,
    ranSeconds: 600,
    afterWait: false,
    commitsSinceWait: 0,
    ...over,
  });

  it('answers dropped for a status-0 exit with the termination line', () => {
    expect(promptExit(input({ output: TERMINATED }), HARNESS_LIMIT_LINES.claude)).toEqual({
      answer: 'dropped',
      line: TERMINATED,
    });
  });

  it('answers dropped for a closing waiting line from a harness the table does not know', () => {
    expect(promptExit(input({ output: MONITOR }), undefined)).toEqual({ answer: 'dropped', line: MONITOR });
  });

  it('answers unstarted for a non-zero exit with the termination line', () => {
    expect(promptExit(input({ status: 1, output: TERMINATED }), HARNESS_LIMIT_LINES.claude)).toEqual({ answer: 'unstarted' });
  });

  it('answers ran for a status-0 exit with neither shape', () => {
    expect(promptExit(input({ output: 'PR #12 opened.' }), HARNESS_LIMIT_LINES.claude)).toEqual({ answer: 'ran' });
  });
});
