import { describe, it, expect } from 'vitest';
import {
  checkChangeset,
  parseChangeset,
  publishedDescription,
  MIN_DESCRIPTION,
  type ChangesetProblem,
} from '../src/rules/changeset.js';

/**
 * The changeset rule, tested against the file shapes that produced the defect.
 *
 * The fixtures are written as whole files rather than as parts, because WHICH
 * line counts as the description is the entire bug — a test that handed the
 * rule a description directly would assert the parse it is supposed to check.
 *
 * The marker is assembled from `'<!' + '--'` throughout. Writing it literally
 * inside a fixture would open a comment in this file for any tool reading it
 * the way `plot-plan-meta.sh` does, which is the sibling defect this plan's
 * second slice covers.
 */
const OPEN = '<!' + '--';
const CLOSE = '--' + '>';

const WORKSPACE = ['plot', '@plot-pm/board', '@plot-pm/domain'];

/** A changeset with its description first and the bumps block last. */
const wellFormed = [
  '---',
  "'plot': patch",
  '---',
  '',
  '`plot-deliver.sh` reads a `## Slices` heading.',
  '',
  OPEN,
  'bumps:',
  '  skills:',
  '    plot: patch',
  CLOSE,
  '',
].join('\n');

/** The same content with the block first — the shape that published a marker. */
const commentFirst = [
  '---',
  "'plot': patch",
  '---',
  '',
  OPEN,
  'bumps:',
  '  skills:',
  '    plot: patch',
  CLOSE,
  '',
  '`plot-deliver.sh` reads a `## Slices` heading.',
  '',
].join('\n');

const refusals = (problems: ChangesetProblem[]) => problems.map((p) => p.refusal);

describe('checkChangeset — the description Changesets would publish is real prose', () => {
  it('accepts a changeset whose description comes before the bumps block', () => {
    expect(checkChangeset(wellFormed, WORKSPACE)).toEqual([]);
  });

  it('refuses no-description when the bumps block is written first', () => {
    // The published entry would read as a bare comment-open marker: 19 of the
    // 169 entries on main, measured 2026-08-30.
    const problems = checkChangeset(commentFirst, WORKSPACE);
    expect(refusals(problems)).toEqual(['no-description']);
    expect(problems[0].detail).toBe(OPEN);
  });

  it('refuses a description shorter than the floor, and accepts one at it', () => {
    const withBody = (description: string) =>
      ['---', "'plot': patch", '---', '', description, ''].join('\n');

    expect(refusals(checkChangeset(withBody('wip'), WORKSPACE))).toEqual([
      'no-description',
    ]);
    expect(refusals(checkChangeset(withBody('.'), WORKSPACE))).toEqual([
      'no-description',
    ]);

    // The boundary itself, from both sides — the floor is a guess, so the test
    // pins where it currently sits rather than restating the number.
    const atFloor = 'x'.repeat(MIN_DESCRIPTION);
    const belowFloor = 'x'.repeat(MIN_DESCRIPTION - 1);
    expect(checkChangeset(withBody(atFloor), WORKSPACE)).toEqual([]);
    expect(refusals(checkChangeset(withBody(belowFloor), WORKSPACE))).toEqual([
      'no-description',
    ]);
  });

  it('refuses a changeset with no body at all', () => {
    const empty = ['---', "'plot': patch", '---', '', ''].join('\n');
    const problems = checkChangeset(empty, WORKSPACE);
    expect(refusals(problems)).toEqual(['no-description']);
    expect(problems[0].detail).toBe('');
  });

  it('refuses unknown-package and names which name was wrong', () => {
    // Measured 2026-08-26: six changesets named packages the workspace lacks,
    // and `changeset version` aborts the entire release on one of them.
    const unknown = [
      '---',
      "'@plot-pm/plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
    ].join('\n');
    const problems = checkChangeset(unknown, WORKSPACE);
    expect(refusals(problems)).toEqual(['unknown-package']);
    expect(problems[0].detail).toBe('@plot-pm/plot');
  });

  it('reports every problem rather than only the first', () => {
    // One run must name everything to fix; a first-failure exit costs a
    // contributor a second CI round trip per problem.
    const both = ['---', "'plot-deliver': patch", '---', '', OPEN, 'bumps:', CLOSE, ''].join(
      '\n',
    );
    expect(refusals(checkChangeset(both, WORKSPACE))).toEqual([
      'unknown-package',
      'no-description',
    ]);
  });

  it('accepts every package name the frontmatter declares', () => {
    const multi = [
      '---',
      "'plot': patch",
      '"@plot-pm/board": minor',
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
    ].join('\n');
    expect(checkChangeset(multi, WORKSPACE)).toEqual([]);
  });
});

describe('parseChangeset — the split the measurement is taken from', () => {
  it('strips single and double quotes from package names', () => {
    expect(parseChangeset(wellFormed).packages).toEqual(['plot']);
    const doubled = ['---', '"@plot-pm/board": minor', '---', '', 'body'].join('\n');
    expect(parseChangeset(doubled).packages).toEqual(['@plot-pm/board']);
  });

  it('yields no packages and the whole text as body when there is no frontmatter', () => {
    // Left to `changeset` itself to complain about; this rule refuses only on
    // its own two measurements.
    const parts = parseChangeset('just prose, no frontmatter at all\n');
    expect(parts.packages).toEqual([]);
    expect(parts.body).toEqual(['just prose, no frontmatter at all', '']);
  });

  it('treats an unterminated frontmatter block as having no body', () => {
    const parts = parseChangeset(['---', "'plot': patch"].join('\n'));
    expect(parts.packages).toEqual(['plot']);
    expect(parts.body).toEqual([]);
  });

  it('ignores frontmatter lines that declare nothing', () => {
    const parts = parseChangeset(
      ['---', '', "'plot': patch", 'no-colon-here', '---', '', 'body'].join('\n'),
    );
    expect(parts.packages).toEqual(['plot']);
  });

  it('ignores a line whose name is empty before the colon', () => {
    expect(parseChangeset(['---', ': patch', '---', '', 'body'].join('\n')).packages).toEqual(
      [],
    );
  });

  it('skips blank lines before the opening delimiter', () => {
    expect(parseChangeset(['', '', '---', "'plot': patch", '---', '', 'b'].join('\n')).packages)
      .toEqual(['plot']);
  });

  it('treats a wholly empty file as having no frontmatter', () => {
    expect(parseChangeset('').packages).toEqual([]);
  });
});

describe('publishedDescription — what Changesets prints, whatever it is', () => {
  it('returns the first non-empty line, trimmed', () => {
    expect(publishedDescription(['', '  ', '  the description  ', 'more'])).toBe(
      'the description',
    );
  });

  it('returns the comment marker when that is what comes first', () => {
    // Not a guard — a faithful report of the defect's mechanism.
    expect(publishedDescription(['', OPEN, 'bumps:', CLOSE, '', 'real prose'])).toBe(OPEN);
  });

  it('returns empty for a body with nothing in it', () => {
    expect(publishedDescription(['', '   ', ''])).toBe('');
  });
});
