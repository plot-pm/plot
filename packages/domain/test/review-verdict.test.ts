import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  REVIEWER_DENY,
  REVIEWER_TOOLS,
  reviewerCommand,
  reviewerRoleFloor,
  OUTSIDE_THE_CHANGE_HEADING,
  REVIEW_ARGUMENT_LIMIT,
  REVIEW_INLINE_DIFF_LIMIT,
  reviewRequestBlock,
  reviewVerdict,
} from '../src/rules/review-verdict.js';

const refused = (text: string): string => {
  const verdict = reviewVerdict(text);
  if (verdict.read !== 'refused') throw new Error('expected a refusal');
  return verdict.why;
};

describe('reviewVerdict', () => {
  it('reads the counts from the one Findings line', () => {
    expect(reviewVerdict('- a finding\n\nFindings: HIGH 2, MEDIUM 0, LOW 11\n')).toEqual({
      read: 'counted',
      counts: { high: 2, medium: 0, low: 11 },
    });
  });

  it('reads a file with CRLF line endings', () => {
    expect(reviewVerdict('x\r\nFindings: HIGH 0, MEDIUM 1, LOW 0\r\n')).toEqual({
      read: 'counted',
      counts: { high: 0, medium: 1, low: 0 },
    });
  });

  it('refuses a file with no Findings line', () => {
    expect(refused('- a finding\nno counts here\n')).toMatch(/no "Findings:" line/);
    expect(refused('')).toMatch(/no "Findings:" line/);
  });

  it('refuses a file with two Findings lines', () => {
    expect(refused('Findings: HIGH 0, MEDIUM 0, LOW 0\nFindings: HIGH 1, MEDIUM 0, LOW 0\n')).toMatch(/2 "Findings:" lines/);
  });

  it('refuses a non-integer count', () => {
    expect(refused('Findings: HIGH two, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH 1.5, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH -1, MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH , MEDIUM 0, LOW 0')).toMatch(/not "Findings: HIGH/);
  });

  it('refuses counts in another order or with a severity missing', () => {
    expect(refused('Findings: MEDIUM 0, HIGH 0, LOW 0')).toMatch(/not "Findings: HIGH/);
    expect(refused('Findings: HIGH 0, MEDIUM 0')).toMatch(/not "Findings: HIGH/);
  });

  it('refuses a count beyond the safe integer range', () => {
    expect(refused('Findings: HIGH 99999999999999999999, MEDIUM 0, LOW 0')).toMatch(/out of range/);
  });
});

describe('reviewRequestBlock', () => {
  const request = {
    pr: 7, headSha: 'abc123', base: 'main', mergeBase: 'def456',
    files: ['docs/a.md', 'src/b.ts'], diffPath: '/repo/.git/plot/state/reviews/7-head.diff', diff: '+added line\n',
  };

  it('names the PR, the head, the base, the rubric, the read-only rule and the final-answer line', () => {
    const block = reviewRequestBlock(request);
    for (const part of ['#7', 'abc123', 'main', 'HIGH:', 'MEDIUM:', 'LOW:', 'Read-only', 'final answer', 'Findings: HIGH <n>']) {
      expect(block).toContain(part);
    }
  });

  it('names the merge base, the changed files and the diff file', () => {
    const block = reviewRequestBlock(request);
    expect(block).toContain('Merge base: def456');
    expect(block).toContain('`git diff def456..abc123`');
    expect(block).toContain('Changed files (2):\n- docs/a.md\n- src/b.ts');
    expect(block).toContain('Full diff: /repo/.git/plot/state/reviews/7-head.diff');
  });

  it('tells the reviewer to judge only the change and to keep the rest out of the count', () => {
    const block = reviewRequestBlock(request);
    expect(block).toContain('Scope: judge only this change.');
    expect(block).toContain(`"${OUTSIDE_THE_CHANGE_HEADING}"`);
    expect(block).toContain('It never counts in the Findings: line.');
  });

  it('carries the diff inline at the limit', () => {
    const diff = `+${'x'.repeat(REVIEW_INLINE_DIFF_LIMIT - 1)}`;
    const block = reviewRequestBlock({ ...request, diff });
    expect(block).toContain(`\`\`\`diff\n${diff}\n\`\`\``);
    expect(block).not.toContain('not inline');
  });

  it('leaves the diff out one byte over the limit and names the byte count', () => {
    const diff = `+${'x'.repeat(REVIEW_INLINE_DIFF_LIMIT)}`;
    const block = reviewRequestBlock({ ...request, diff });
    expect(block).not.toContain('```diff');
    expect(Buffer.byteLength(diff)).toBe(REVIEW_INLINE_DIFF_LIMIT + 1);
    expect(block).toContain(`The diff holds ${Buffer.byteLength(diff)} bytes, more than ${REVIEW_INLINE_DIFF_LIMIT} bytes, so it is not inline.`);
    expect(block).toContain('Full diff: /repo/.git/plot/state/reviews/7-head.diff');
  });

  it('carries a diff of exactly the limit in bytes inline', () => {
    const diff = 'x'.repeat(REVIEW_INLINE_DIFF_LIMIT);
    expect(Buffer.byteLength(diff)).toBe(REVIEW_INLINE_DIFF_LIMIT);
    expect(reviewRequestBlock({ ...request, diff })).toContain('```diff');
  });

  it('counts bytes, not characters: multi-byte text under the character limit stays out', () => {
    const diff = 'é'.repeat(REVIEW_INLINE_DIFF_LIMIT / 2 + 1);
    expect(diff.length).toBeLessThanOrEqual(REVIEW_INLINE_DIFF_LIMIT);
    expect(Buffer.byteLength(diff)).toBeGreaterThan(REVIEW_INLINE_DIFF_LIMIT);
    const block = reviewRequestBlock({ ...request, diff });
    expect(block).not.toContain('```diff');
    expect(block).toContain(`The diff holds ${Buffer.byteLength(diff)} bytes`);
  });

  it('keeps charter prompt and request with a diff at the limit under the exec argument cap', () => {
    const charterPrompt = 'p'.repeat(13_563);
    const files = Array.from({ length: 200 }, (_, i) => `packages/board/src/some/deep/path/file-${i}.ts`);
    const block = reviewRequestBlock({ ...request, files, diff: 'x'.repeat(REVIEW_INLINE_DIFF_LIMIT) });
    expect(Buffer.byteLength(`${charterPrompt}\n\n${block}`)).toBeLessThan(REVIEW_ARGUMENT_LIMIT);
  });

  it('says so when the change touches no file', () => {
    expect(reviewRequestBlock({ ...request, files: [], diff: '' })).toContain('Changed files (0):\n- (none)');
  });
});

const ROLE = { model: '', effort: '', maxTurns: 0, agentsFile: '/repo/.plot/state/reviewer/agents.json' };
const AGENT_TAIL = " --agent reviewer --agents \"$(cat -- '/repo/.plot/state/reviewer/agents.json')\"";

const command = (role: Partial<typeof ROLE>): string => {
  const built = reviewerCommand({ ...ROLE, ...role }, []);
  if (built.read !== 'command') throw new Error(`expected a command, got ${built.why}`);
  return built.command;
};

describe('reviewerCommand', () => {
  it('runs claude with read and search tools only, no MCP, user settings only, and no bypass', () => {
    expect(command({})).toBe(
      'claude -p --tools Read,Grep,Glob --disallowedTools Write,Edit,NotebookEdit,Bash,Agent,Task,WebFetch,WebSearch'
        + ` --setting-sources user --permission-mode dontAsk --strict-mcp-config${AGENT_TAIL}`,
    );
  });

  it('adds each read directory before the tool list, single-quoted with a quote escaped', () => {
    const built = reviewerCommand(ROLE, ['/repo/.git/plot/state/reviews', "/it's here"]);
    if (built.read !== 'command') throw new Error(built.why);
    expect(built.command).toContain(
      "claude -p --add-dir '/repo/.git/plot/state/reviews' --add-dir '/it'\\''s here' --tools Read,Grep,Glob ",
    );
  });

  it('names the role model, effort and turn limit', () => {
    const built = command({ model: 'claude-opus-4[1m]', effort: 'high', maxTurns: 40 });
    expect(built).toContain("--model 'claude-opus-4[1m]' --effort 'high' --max-turns 40 ");
    expect(built).not.toContain('bypassPermissions');
  });

  it('lists no write, shell or network tool in the tools it offers', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']) {
      expect(REVIEWER_TOOLS).not.toContain(tool);
      expect(REVIEWER_DENY).toContain(tool);
    }
  });

  it('refuses a model or effort that is not one word', () => {
    expect(reviewerCommand({ ...ROLE, model: "opus' --permission-mode bypassPermissions '" }, [])).toMatchObject({
      read: 'refused',
      why: expect.stringContaining('model'),
    });
    expect(reviewerCommand({ ...ROLE, effort: 'high; rm -rf /' }, [])).toMatchObject({
      read: 'refused',
      why: expect.stringContaining('effort'),
    });
  });

  it('refuses a turn limit that is not a whole number', () => {
    expect(reviewerCommand({ ...ROLE, maxTurns: -1 }, [])).toMatchObject({ read: 'refused' });
  });
});

const REVIEWER_MD = `---
description: Reviews one pull request.
prompt: .plot/worker-prompt.sh
model: opus
effort: high
tools:
  - Read
  - Grep
  - Glob
maxTurns: 40
isolation: worktree
---

Body.
`;

const withKey = (line: string): string => REVIEWER_MD.replace('maxTurns: 40', `maxTurns: 40\n${line}`);

describe('reviewerRoleFloor', () => {
  it('admits the shipped reviewer.md and reads its model and effort', () => {
    expect(reviewerRoleFloor(readFileSync(new URL('../../../.claude/agents/reviewer.md', import.meta.url), 'utf8')))
      .toEqual({ read: 'floor', model: 'opus', effort: 'high' });
    expect(reviewerRoleFloor(REVIEWER_MD)).toEqual({ read: 'floor', model: 'opus', effort: 'high' });
  });

  it.each([
    ['tools', REVIEWER_MD.replace('  - Glob', '  - Glob\n  - Bash')],
    ['tools', REVIEWER_MD.replace(/tools:\n(  - .*\n)+/, 'tools: Read, Bash\n')],
    ['mcpServers', withKey('mcpServers:\n  - evil')],
    ['permissionMode', withKey('permissionMode: bypassPermissions')],
    ['disallowedTools', withKey('disallowedTools: Write')],
  ])('refuses %s that widens the floor, naming the key', (key, text) => {
    expect(reviewerRoleFloor(text)).toEqual({ read: 'refused', why: `reviewer-role-widens: ${key}` });
  });

  it('admits a disallowedTools list that holds the whole floor', () => {
    expect(reviewerRoleFloor(withKey(`disallowedTools: ${REVIEWER_DENY.join(', ')}`)).read).toBe('floor');
  });

  it('reads a file that declares no tools, model or effort, skipping a line that is no key', () => {
    expect(reviewerRoleFloor('---\ndescription: x\n# a comment\n---\nBody\n')).toEqual({ read: 'floor', model: '', effort: '' });
  });

  it('reads an inline, quoted tools list', () => {
    expect(reviewerRoleFloor(REVIEWER_MD.replace(/tools:\n(  - .*\n)+/, 'tools: [Read, "Grep"]\n')).read).toBe('floor');
  });

  it.each([
    ['model', REVIEWER_MD.replace('model: opus', "model: 'opus; x'")],
    ['effort', REVIEWER_MD.replace('effort: high', 'effort: hi gh')],
  ])('refuses a %s that is not one word', (key, text) => {
    expect(reviewerRoleFloor(text)).toMatchObject({ read: 'refused', why: expect.stringContaining(`reviewer's ${key}`) });
  });

  it('refuses a file with no frontmatter', () => {
    expect(reviewerRoleFloor('no frontmatter')).toMatchObject({ read: 'refused' });
  });
});
