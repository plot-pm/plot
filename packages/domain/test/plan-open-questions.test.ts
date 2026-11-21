import { describe, expect, it } from 'vitest';
import { openQuestionsChip, openQuestionsMore, openQuestionsTone, planOpenQuestions, sliceCountChip } from '../src/rules/plan-open-questions.js';

describe('planOpenQuestions', () => {
  it('counts the unchecked items of both headings', () => {
    const text = '# P\n\n### Open Questions\n\n- [ ] first?\n- [x] done\n\n## Slices\n- [ ] not a question\n\n## Open Points\n\n- [ ] second\n';
    expect(planOpenQuestions(text)).toEqual({ count: 2, first: 'first?' });
  });
  it('reads 0 where the heading holds only checked items', () => {
    expect(planOpenQuestions('### Open Questions\n- [x] a\n- [x] b\n')).toEqual({ count: 0, first: null });
  });
  it('carries no count where neither heading exists', () => {
    expect(planOpenQuestions('# P\n- [ ] x\n')).toBeNull();
  });
  it('ignores a heading inside a code fence', () => {
    expect(planOpenQuestions('```\n## Open Points\n- [ ] x\n```\n')).toBeNull();
  });
  it('drops one leading named identifier from the first line', () => {
    expect(planOpenQuestions('## Open Points\n- [ ] [question-row-text] Does the row show it?\n')).toEqual({ count: 1, first: 'Does the row show it?' });
    expect(planOpenQuestions('## Open Points\n- [ ] ⏸️ `[question-row-text]` Does the row show it?\n')).toEqual({ count: 1, first: '⏸️ Does the row show it?' });
  });
  it('leaves an unnamed line whole, including a leading bracket of ordinary text', () => {
    expect(planOpenQuestions('## Open Points\n- [ ] Does the row show it?\n')).toEqual({ count: 1, first: 'Does the row show it?' });
    expect(planOpenQuestions('## Open Points\n- [ ] [x] stays\n')).toEqual({ count: 1, first: '[x] stays' });
    expect(planOpenQuestions('## Open Points\n- [ ] [the spec](docs/spec.md) says so\n')).toEqual({ count: 1, first: '[the spec](docs/spec.md) says so' });
  });
  it('counts a bare name as open and returns the name itself', () => {
    expect(planOpenQuestions('## Open Points\n- [ ] [question-checklist-line-first-token]\n- [ ] second\n')).toEqual({ count: 2, first: '[question-checklist-line-first-token]' });
  });
});

describe('chips', () => {
  it('shows +n more only above 0', () => {
    expect(openQuestionsMore({ count: 1, first: 'a' })).toBeNull();
    expect(openQuestionsMore({ count: 3, first: 'a' })).toBe('+2 more');
    expect(openQuestionsMore(null)).toBeNull();
  });
  it('words the open-question chip and slice chip', () => {
    expect(openQuestionsChip({ count: 0, first: null })).toBe('0 open');
    expect(openQuestionsChip(null)).toBeNull();
    expect(sliceCountChip(5)).toBe('5 slices');
    expect(sliceCountChip(1)).toBe('1 slice');
    expect(sliceCountChip(0)).toBeNull();
  });
});

describe('openQuestionsTone', () => {
  it('is warn where a question is open and neutral where none is', () => {
    expect(openQuestionsTone({ count: 3, first: 'x' })).toBe('warn');
    expect(openQuestionsTone({ count: 0, first: null })).toBe('neutral');
  });
  it('is absent where the chip is null, which is not neutral', () => {
    expect(openQuestionsTone(null)).toBeNull();
    expect(openQuestionsTone(undefined)).toBeNull();
  });
  it('leaves the chip text as it was', () => {
    expect(openQuestionsChip(null)).toBeNull();
    expect(openQuestionsChip(undefined)).toBeNull();
    expect(openQuestionsChip({ count: 0, first: null })).toBe('0 open');
    expect(openQuestionsChip({ count: 3, first: 'x' })).toBe('3 open');
  });
});
