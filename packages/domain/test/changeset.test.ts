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

  it('refuses a comment-open line that is long enough to clear the floor', () => {
    // THE ARMS MUST DISAGREE SOMEWHERE, or one of them is untested. A bare
    // marker is 4 characters, so the length floor alone refuses it and deleting
    // the marker check leaves every other test green — measured by mutation
    // while writing these. A single-line block is 30 characters and prose-
    // shaped to the floor, so only the marker check can refuse it.
    const oneLineBlock = [
      '---',
      "'plot': patch",
      '---',
      '',
      `${OPEN} bumps: { plot: patch } ${CLOSE}`,
      '',
      'The real description, which nobody ever reads.',
      '',
    ].join('\n');

    const first = publishedDescription(parseChangeset(oneLineBlock).body);
    expect(first.length).toBeGreaterThanOrEqual(MIN_DESCRIPTION);

    expect(refusals(checkChangeset(oneLineBlock, WORKSPACE))).toEqual(['no-description']);
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

describe('parseChangeset — the plan a changeset names', () => {
  /** The shape CLAUDE.md documents, with a plan link added inside the block. */
  const withPlan = [
    '---',
    "'plot': patch",
    '---',
    '',
    'A description that is comfortably long enough to pass the floor.',
    '',
    OPEN,
    'plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md',
    'bumps:',
    '  skills:',
    '    plot: patch',
    CLOSE,
    '',
  ].join('\n');

  it('reads the plan the body names', () => {
    expect(parseChangeset(withPlan).plan).toBe(
      'docs/plans/2026-09-06-a-changeset-names-its-plan.md',
    );
  });

  it('leaves the plan undefined when the changeset names none', () => {
    // THE LINK IS OPTIONAL, and this is the assertion that says so. 0 of 19
    // changesets carried one when this was written; absence is the normal case
    // and it is not a defect.
    expect(parseChangeset(wellFormed).plan).toBeUndefined();
  });

  it('still publishes the description, never the plan line', () => {
    // The 11% failure, asserted for the new line. `bumps:` written first
    // published a bare marker in 19 of 169 entries; a `plan:` line placed
    // first would reintroduce exactly that, so the changeset must carry both
    // its link and its prose without the link ever becoming the note.
    const parts = parseChangeset(withPlan);
    expect(publishedDescription(parts.body)).toBe(
      'A description that is comfortably long enough to pass the floor.',
    );
    expect(checkChangeset(withPlan, WORKSPACE)).toEqual([]);
  });

  it('refuses a plan line written before the description', () => {
    // Not a new measurement — the existing one. A `plan:` line first IS the
    // published description, so `no-description` refuses it by the floor,
    // without the rule needing to know what kind of line it was.
    const planFirst = [
      '---',
      "'plot': patch",
      '---',
      '',
      'plan: docs/plans/x.md',
      '',
      'The real description, which nobody would ever read.',
      '',
    ].join('\n');

    expect(parseChangeset(planFirst).plan).toBe('docs/plans/x.md');
    expect(refusals(checkChangeset(planFirst, WORKSPACE))).toEqual(['no-description']);
  });

  it('reads a plan line outside the comment block', () => {
    // The block is not required to exist, and a `plan:` line without one is
    // the same statement. Reading only inside it would silently ignore a link
    // a contributor did write.
    const bare = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      'plan: docs/plans/2026-09-06-a-changeset-names-its-plan.md',
      '',
    ].join('\n');
    expect(parseChangeset(bare).plan).toBe(
      'docs/plans/2026-09-06-a-changeset-names-its-plan.md',
    );
  });

  it('takes the first plan line when a body names more than one', () => {
    const twice = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      'plan: docs/plans/first.md',
      'plan: docs/plans/second.md',
      '',
    ].join('\n');
    expect(parseChangeset(twice).plan).toBe('docs/plans/first.md');
  });

  it('ignores a plan key with nothing after it', () => {
    // An empty value is not a link. Returning `''` would make the fast path
    // look present and resolve to no plan at all.
    const empty = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      'plan:',
      '',
    ].join('\n');
    expect(parseChangeset(empty).plan).toBeUndefined();
  });

  it('reads a plan from a file with no frontmatter', () => {
    // Both return paths carry the same reading; a parse that learned it on one
    // would answer differently for a malformed file than for a valid one.
    expect(parseChangeset('plan: docs/plans/x.md\n').plan).toBe('docs/plans/x.md');
  });
});

describe('parseChangeset — the bumps block, learned with the plan link', () => {
  it('reads the skill bumps the block declares', () => {
    // A `plan:` reference and `bumps:` are the same kind of thing: a structured
    // comment in the body. CLAUDE.md has documented `bumps:` throughout and
    // nothing parsed it, so the parser learns both or neither.
    const parts = parseChangeset(wellFormed);
    expect(parts.bumps).toEqual({ plot: 'patch' });
  });

  it('reads every skill the block names', () => {
    const many = [
      '---',
      "'plot': minor",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      OPEN,
      'bumps:',
      '  skills:',
      '    plot-dispatch: minor',
      '    plot-deliver: patch',
      CLOSE,
      '',
    ].join('\n');
    expect(parseChangeset(many).bumps).toEqual({
      'plot-dispatch': 'minor',
      'plot-deliver': 'patch',
    });
  });

  it('yields no bumps when the block is absent', () => {
    const none = [
      '---',
      "'@plot-pm/board': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
    ].join('\n');
    expect(parseChangeset(none).bumps).toEqual({});
  });

  it('does not read prose after the block as a skill', () => {
    // The block ends at the comment close. Without that stop, a following
    // paragraph containing a colon would be read as a skill and a bump level.
    const trailing = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      OPEN,
      'bumps:',
      '  skills:',
      '    plot: patch',
      CLOSE,
      '',
      'Note: this trailing paragraph is prose.',
      '',
    ].join('\n');
    expect(parseChangeset(trailing).bumps).toEqual({ plot: 'patch' });
  });

  it('yields no bumps when the block names no skills mapping', () => {
    const headerOnly = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      OPEN,
      'bumps:',
      CLOSE,
      '',
    ].join('\n');
    expect(parseChangeset(headerOnly).bumps).toEqual({});
  });

  it('stops at a line that leaves the mapping', () => {
    // A dedented line has left the block. Reading on would attach whatever
    // followed to the skills mapping.
    const dedented = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      'bumps:',
      '  skills:',
      '    plot: patch',
      'unrelated: text',
      '',
    ].join('\n');
    expect(parseChangeset(dedented).bumps).toEqual({ plot: 'patch' });
  });
});

describe('parseChangeset — the shapes a bumps block can take', () => {
  it('ignores a key inside the block that is not the skills mapping', () => {
    // `bumps:` may carry keys other than `skills:`. Reading their values as
    // skill names would invent bumps for a mapping nobody wrote.
    const other = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      OPEN,
      'bumps:',
      '  plugin: minor',
      '  skills:',
      '    plot: patch',
      CLOSE,
      '',
    ].join('\n');
    expect(parseChangeset(other).bumps).toEqual({ plot: 'patch' });
  });

  it('reads through a blank line inside the mapping', () => {
    // A blank line is spacing, not the end of the block — stopping there would
    // silently drop every skill written after it.
    const spaced = [
      '---',
      "'plot': patch",
      '---',
      '',
      'A description that is comfortably long enough to pass the floor.',
      '',
      OPEN,
      'bumps:',
      '  skills:',
      '    plot: patch',
      '',
      '    plot-deliver: minor',
      CLOSE,
      '',
    ].join('\n');
    expect(parseChangeset(spaced).bumps).toEqual({
      plot: 'patch',
      'plot-deliver': 'minor',
    });
  });
});
