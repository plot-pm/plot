// `composeContinuation` — what it writes for a marker-driven reply versus a
// fresh start that never had a question to answer.
import { describe, expect, it } from 'vitest';
import { composeContinuation } from '../../src/shared/continuation.js';

const base = {
  branch: 'infra/x',
  briefPath: '.plot/briefs/infra-x.md',
  briefText: '# Brief',
  answer: 'use the shell adapter',
  landed: [] as string[],
};

describe('composeContinuation — a marker-driven reply', () => {
  it('names the previous question and tells the worker to clear the marker', () => {
    const prompt = composeContinuation({ ...base, question: 'which adapter?' });
    expect(prompt).toContain('stopped to ask a question');
    expect(prompt).toContain('## The question that stopped the previous run');
    expect(prompt).toContain('which adapter?');
    expect(prompt).toContain('blocked marker that stopped the previous run is still in this tree');
  });
});

describe('composeContinuation — a fresh start with no marker', () => {
  it('describes neither a question nor a marker to clear', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).not.toContain('stopped to ask a question');
    expect(prompt).not.toContain('blocked marker that stopped the previous run is still in this tree');
    expect(prompt).not.toContain('## The question that stopped the previous run');
  });

  it('still carries the answer and the brief', () => {
    const prompt = composeContinuation({ ...base, question: '' });
    expect(prompt).toContain('## The answer');
    expect(prompt).toContain('use the shell adapter');
    expect(prompt).toContain('# Brief');
  });
});
