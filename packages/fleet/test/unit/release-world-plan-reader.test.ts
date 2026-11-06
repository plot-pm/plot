import { describe, expect, it } from 'vitest';
import { parseChangeset } from '@plot-pm/domain/rules/changeset';
import { planOfChangeset } from '../../src/shared/release-world.js';

const body = (lines: string): string => `---\n'plot': patch\n---\n\nA description long enough to publish.\n\n<!--\n${lines}\n-->\n`;

describe('planOfChangeset reads a plan: line as parseChangeset does', () => {
  const cases: [string, string][] = [
    ['a plan line', 'plan: docs/plans/2026-11-03-x.md\nbumps:\n  skills:\n    plot: patch'],
    ['a commented plan line', '# plan: docs/plans/2026-11-03-x.md'],
    ['two plan lines, the first winning', 'plan: docs/plans/a.md\nplan: docs/plans/b.md'],
    ['no plan line', 'bumps:\n  skills:\n    plot: patch'],
  ];
  for (const [name, lines] of cases) {
    it(`agrees on ${name}`, () => {
      const text = body(lines);
      expect(planOfChangeset(text)).toBe(parseChangeset(text).plan ?? '');
    });
  }

  it('answers the empty string where a changeset names no plan, and the written path where it does', () => {
    expect(planOfChangeset(body('bumps:'))).toBe('');
    expect(planOfChangeset(body('plan: docs/plans/a.md'))).toBe('docs/plans/a.md');
  });
});
