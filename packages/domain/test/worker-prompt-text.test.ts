import { describe, expect, it } from 'vitest';
import { parsePromptFile, promptCandidates, renderPrompt } from '../src/rules/worker-prompt-text.js';
import { CHECKS_TAIL_LINES, failedCheck, printedCommands } from '../src/rules/local-checks-run.js';

describe('promptCandidates', () => {
  it("reads a charter's .md prompt first, then the project file", () => {
    expect(promptCandidates('.plot/prompts/reviewer.md')).toEqual(['.plot/prompts/reviewer.md', '.plot/worker-prompt.md']);
  });

  it("reads the .md sibling of a charter's .sh prompt, without duplicates", () => {
    expect(promptCandidates('.plot/worker-prompt.sh')).toEqual(['.plot/worker-prompt.md']);
    expect(promptCandidates('.plot/reviewer.sh')).toEqual(['.plot/reviewer.md', '.plot/worker-prompt.md']);
  });

  it('reads only the project file with no charter, or a charter prompt of another kind', () => {
    expect(promptCandidates('')).toEqual(['.plot/worker-prompt.md']);
    expect(promptCandidates('.plot/reviewer.txt')).toEqual(['.plot/worker-prompt.md']);
  });
});

describe('parsePromptFile', () => {
  it('reads the deny list from the front matter and the body after it', () => {
    expect(parsePromptFile('---\nkind: x\nread-only-deny: Write, Edit ,Bash\n---\n\nYou are {branch}.\n')).toEqual({
      body: 'You are {branch}.',
      readOnlyDeny: ['Write', 'Edit', 'Bash'],
    });
  });

  it('answers no deny list for front matter without one, or for no front matter', () => {
    expect(parsePromptFile('---\nkind: x\n---\nbody')).toEqual({ body: 'body', readOnlyDeny: null });
    expect(parsePromptFile('  body\n')).toEqual({ body: 'body', readOnlyDeny: null });
  });
});

describe('renderPrompt', () => {
  it('fills the branch, the brief path and the script directory', () => {
    expect(renderPrompt('{branch} reads {brief}; run {scripts}/x {branch}', 'infra/the-x', '/s')).toBe(
      'infra/the-x reads .plot/briefs/the-x.md; run /s/x infra/the-x',
    );
  });
});

describe('printedCommands', () => {
  it('keeps the command lines and drops notes, the summary and blanks', () => {
    expect(printedCommands('node --test a.mjs\n# CI suites: x\n\npnpm run typecheck\nsummary: commands=2\n')).toEqual([
      'node --test a.mjs',
      'pnpm run typecheck',
    ]);
  });
});

describe('failedCheck', () => {
  it('carries the command and the last 80 lines of its output', () => {
    const output = `${Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')}\n`;
    const reading = failedCheck('pnpm test', output);
    expect(reading).toMatchObject({ passed: false, command: 'pnpm test' });
    if (reading.passed) return;
    expect(reading.tail.split('\n')).toHaveLength(CHECKS_TAIL_LINES);
    expect(reading.tail.split('\n')[0]).toBe('line 21');
    expect(reading.tail.endsWith('line 100')).toBe(true);
  });
});
