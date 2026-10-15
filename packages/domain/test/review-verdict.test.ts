import { describe, it, expect } from 'vitest';
import {
  REVIEWER_DENY,
  REVIEWER_TOOLS,
  reviewerCommand,
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

const command = (charter: { harness: string; model: string; effort: string }): string => {
  const built = reviewerCommand(charter, []);
  if (built.read !== 'command') throw new Error(`expected a command, got ${built.why}`);
  return built.command;
};

describe('reviewerCommand', () => {
  it('runs claude with read and search tools only, no MCP, user settings only, and no bypass', () => {
    expect(command({ harness: '', model: '', effort: '' })).toBe(
      'claude -p --tools Read,Grep,Glob --disallowedTools Write,Edit,NotebookEdit,Bash,Agent,Task,WebFetch,WebSearch'
        + ' --setting-sources user --permission-mode dontAsk --strict-mcp-config',
    );
  });

  it('adds each read directory before the tool list, single-quoted with a quote escaped', () => {
    const built = reviewerCommand({ harness: '', model: '', effort: '' }, ['/repo/.git/plot/state/reviews', "/it's here"]);
    if (built.read !== 'command') throw new Error(built.why);
    expect(built.command).toContain(
      "claude -p --add-dir '/repo/.git/plot/state/reviews' --add-dir '/it'\\''s here' --tools Read,Grep,Glob ",
    );
    expect(built.command.endsWith(' --strict-mcp-config')).toBe(true);
  });

  it('names the charter model and effort, single-quoted', () => {
    const built = command({ harness: 'claude', model: 'claude-opus-4[1m]', effort: 'high' });
    expect(built).toContain("--model 'claude-opus-4[1m]' --effort 'high' ");
    expect(built).not.toContain('bypassPermissions');
  });

  it('lists no write, shell or network tool in the tools it offers', () => {
    for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']) {
      expect(REVIEWER_TOOLS).not.toContain(tool);
      expect(REVIEWER_DENY).toContain(tool);
    }
  });

  it('refuses a harness other than claude', () => {
    expect(reviewerCommand({ harness: 'codex', model: '', effort: '' }, [])).toEqual({
      read: 'refused',
      why: "the reviewer runs read-only on claude only; the charter names harness 'codex'",
    });
  });

  it('refuses a model or effort that is not one word', () => {
    expect(reviewerCommand({ harness: '', model: "opus' --permission-mode bypassPermissions '", effort: '' }, [])).toMatchObject({
      read: 'refused',
      why: expect.stringContaining("model"),
    });
    expect(reviewerCommand({ harness: '', model: 'opus', effort: 'high; rm -rf /' }, [])).toMatchObject({
      read: 'refused',
      why: expect.stringContaining('effort'),
    });
  });
});
