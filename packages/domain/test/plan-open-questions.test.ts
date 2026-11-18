import { describe, expect, it } from 'vitest';
import { openQuestionsChip, openQuestionsMore, planOpenQuestions, sliceCountChip } from '../src/rules/plan-open-questions.js';

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
