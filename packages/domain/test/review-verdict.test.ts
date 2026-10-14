import { describe, it, expect } from 'vitest';
import {
  REVIEWER_DENY,
  REVIEWER_TOOLS,
  reviewerCommand,
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
  it('names the PR, the head, the base, the rubric, the read-only rule and the final-answer line', () => {
    const block = reviewRequestBlock({ pr: 7, headSha: 'abc123', base: 'main' });
    for (const part of ['#7', 'abc123', 'main', 'HIGH:', 'MEDIUM:', 'LOW:', 'Read-only', 'final answer', 'Findings: HIGH <n>']) {
      expect(block).toContain(part);
    }
  });
});

const command = (charter: { harness: string; model: string; effort: string }): string => {
  const built = reviewerCommand(charter);
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
    expect(reviewerCommand({ harness: 'codex', model: '', effort: '' })).toEqual({
      read: 'refused',
      why: "the reviewer runs read-only on claude only; the charter names harness 'codex'",
    });
  });

  it('refuses a model or effort that is not one word', () => {
    expect(reviewerCommand({ harness: '', model: "opus' --permission-mode bypassPermissions '", effort: '' })).toMatchObject({
      read: 'refused',
      why: expect.stringContaining("model"),
    });
    expect(reviewerCommand({ harness: '', model: 'opus', effort: 'high; rm -rf /' })).toMatchObject({
      read: 'refused',
      why: expect.stringContaining('effort'),
    });
  });
});
