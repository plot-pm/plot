import { describe, it, expect } from 'vitest';
import {
  renderRecordLine,
  withRecord,
  withPhase,
  withoutHold,
  withSprintAnnotation,
  pathsOf,
  pathsNamedBy,
  HOLD_FILE,
} from '../src/index.js';
import type { Decision, Write } from '../src/index.js';

/**
 * How a decision's writes become plan-file text.
 *
 * Every rule here exists because a shell script got it wrong first, and the
 * source names each incident. The tests are written against those incidents
 * rather than against the code's shape: a test that only re-states the
 * implementation goes green when the implementation goes wrong the same way.
 */

/** The Status block as the template ships it, with its empty placeholders. */
const PLAN = `# Ship the widget

## Status

- **Phase:** Draft
- **Type:** feature
- **Approved:**
- **Delivered:** <!-- YYYY-MM-DD -->

## Design

Prose.
`;

describe('a record line is one shape, everywhere', () => {
  it('renders the form the parser reads', () => {
    expect(renderRecordLine('Delivered', '2026-08-31, alice')).toBe(
      '- **Delivered:** 2026-08-31, alice',
    );
  });
});

describe('a record fills its placeholder, and does not stack below one', () => {
  it('fills a BARE placeholder rather than appending after it', () => {
    // `plot-dispatch.sh:423` appended below `- **Delivered:**` instead of
    // filling it until 2026-08-17, and the parser still read the result — so
    // nothing failed loudly while two plans listed a start after a delivery.
    const { text, wrote } = withRecord(PLAN, 'Approved', '2026-08-31, alice');
    expect(wrote).toBe(true);
    expect(text).toContain('- **Approved:** 2026-08-31, alice');
    // Exactly one Approved line: appending would have left the empty one too.
    expect(text.match(/\*\*Approved:\*\*/g)).toHaveLength(1);
  });

  it('fills a placeholder whose value is an HTML comment', () => {
    // The template ships `<!-- YYYY-MM-DD -->`, so both spellings of "empty"
    // count as a slot. Treating only the bare form as fillable would stack a
    // second Delivered line under the commented one.
    const { text } = withRecord(PLAN, 'Delivered', '2026-08-31, bob');
    expect(text).toContain('- **Delivered:** 2026-08-31, bob');
    expect(text).not.toContain('YYYY-MM-DD');
    expect(text.match(/\*\*Delivered:\*\*/g)).toHaveLength(1);
  });

  it('appends after the last list item when no placeholder exists', () => {
    const noSlot = '# P\n\n## Status\n\n- **Phase:** Draft\n\n## Design\n';
    const { text, wrote } = withRecord(noSlot, 'Started', '2026-08-31, carol');
    expect(wrote).toBe(true);
    // Immediately after the last item, still inside the section.
    expect(text).toMatch(/- \*\*Phase:\*\* Draft\n- \*\*Started:\*\* 2026-08-31, carol/);
  });

  it('does NOT fill a line that already carries a value', () => {
    // A filled record is not a slot. Overwriting one would silently rewrite
    // history — the field this write is not about.
    const filled = PLAN.replace('- **Approved:**', '- **Approved:** 2026-01-01, dave');
    const { text } = withRecord(filled, 'Approved', '2026-08-31, alice');
    expect(text).toContain('2026-01-01, dave');
    expect(text).toContain('- **Approved:** 2026-08-31, alice');
  });

  it('leaves a file with no Status section untouched, and says so', () => {
    // The parser reads records out of that section, so a line written below it
    // parses as nothing — a record on disk and not in the data is worse than
    // no record, because it looks written.
    const { text, wrote } = withRecord('# P\n\n## Design\n\nProse.\n', 'Delivered', 'x');
    expect(wrote).toBe(false);
    expect(text).toBe('# P\n\n## Design\n\nProse.\n');
  });

  it('stops at the next heading rather than filling a later section', () => {
    const twoSections = '# P\n\n## Status\n\n- **Phase:** Draft\n\n## Notes\n\n- **Approved:**\n';
    const { text } = withRecord(twoSections, 'Approved', '2026-08-31, alice');
    // The Notes placeholder is untouched; the record lands in Status.
    expect(text).toMatch(/## Notes\n\n- \*\*Approved:\*\*$/m);
    expect(text).toMatch(/## Status\n\n- \*\*Phase:\*\* Draft\n- \*\*Approved:\*\* 2026-08-31, alice/);
  });
});

describe('a phase changes inside Status, and nowhere else', () => {
  it('rewrites the phase', () => {
    const { text, wrote } = withPhase(PLAN, 'Approved');
    expect(wrote).toBe(true);
    expect(text).toContain('- **Phase:** Approved');
  });

  it('leaves a QUOTED status block in prose alone', () => {
    // This repository documents its own format, so plans quote Status blocks in
    // their prose. An unscoped rewrite would corrupt the very files that
    // specify the format — silently, since they still parse.
    const documenting = `# P

## Status

- **Phase:** Draft

## Design

The template ships:

- **Phase:** Draft
`;
    const { text } = withPhase(documenting, 'Approved');
    expect(text.match(/\*\*Phase:\*\* Approved/g)).toHaveLength(1);
    expect(text.match(/\*\*Phase:\*\* Draft/g)).toHaveLength(1);
    // The surviving Draft is the one in the Design section.
    expect(text.split('## Design')[1]).toContain('- **Phase:** Draft');
  });

  it('reports false when there is no phase line to change', () => {
    const { wrote } = withPhase('# P\n\n## Status\n\n- **Type:** feature\n', 'Approved');
    expect(wrote).toBe(false);
  });

  it('reports false when the phase is already the target', () => {
    // The replace produces an identical line, and an unchanged file must not be
    // reported as written — a caller that commits on `wrote` would make an
    // empty commit.
    const { text, wrote } = withPhase(PLAN, 'Draft');
    expect(wrote).toBe(false);
    expect(text).toBe(PLAN);
  });

  it('reports false when there is no Status section at all', () => {
    const { wrote } = withPhase('# P\n\n## Design\n\n- **Phase:** Draft\n', 'Approved');
    expect(wrote).toBe(false);
  });
});

describe('a hold is released by exact name, never by pattern', () => {
  const HOLDS = 'feature/a plan-one\nfeature/ab plan-two\nfeature/b plan-three\n';

  it('removes only the named branch', () => {
    const { text, wrote } = withoutHold(HOLDS, 'feature/a');
    expect(wrote).toBe(true);
    expect(text).not.toContain('feature/a plan-one');
    // `feature/ab` starts with `feature/a`: a prefix match would take it too,
    // and approving one piece of work must not open someone else's gate.
    expect(text).toContain('feature/ab plan-two');
    expect(text).toContain('feature/b plan-three');
  });

  it('reports false when the branch holds nothing', () => {
    const { text, wrote } = withoutHold(HOLDS, 'feature/absent');
    expect(wrote).toBe(false);
    expect(text).toBe(HOLDS);
  });

  it('matches the first field, tab-separated as the gate reads it', () => {
    const tabbed = 'feature/a\tplan-one\nfeature/b\tplan-two\n';
    const { text, wrote } = withoutHold(tabbed, 'feature/a');
    expect(wrote).toBe(true);
    expect(text).toContain('feature/b');
  });
});

describe('a sprint annotation keeps the keys this write does not name', () => {
  it('adds an annotation to an item that carries none', () => {
    const { text, wrote } = withSprintAnnotation(
      '- [ ] [slug] Do the thing\n', 'slug', 'in-progress', 42, 'feature/x',
    );
    expect(wrote).toBe(true);
    expect(text).toContain('<!-- pr: #42, status: in-progress, branch: feature/x -->');
  });

  it('ticks the box on delivered, and only then', () => {
    const delivered = withSprintAnnotation('- [ ] [slug] Thing\n', 'slug', 'delivered', null, '');
    expect(delivered.text).toContain('- [x]');
    const started = withSprintAnnotation('- [ ] [slug] Thing\n', 'slug', 'in-progress', null, '');
    expect(started.text).toContain('- [ ]');
  });

  it('rewrites status while KEEPING a pr this write did not name', () => {
    // The stated contract: an item keeps every key this write does not name.
    // Passing null for the PR must not erase the one already recorded.
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- pr: #7, status: in-progress -->\n',
      'slug', 'delivered', null, '',
    );
    expect(text).toContain('pr: #7');
    expect(text).toContain('status: delivered');
  });

  it('adds a status key to an annotation that lacks one', () => {
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- pr: #7 -->\n', 'slug', 'delivered', null, '',
    );
    expect(text).toContain('status: delivered');
    expect(text).toContain('pr: #7');
  });

  it('ADDS a pr to an annotation that carries none', () => {
    // The other arm of the pr branch: an item annotated with only a status
    // gains the number rather than losing it into an unmatched replace.
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- status: in-progress -->\n',
      'slug', 'delivered', 99, '',
    );
    expect(text).toContain('pr: #99');
    expect(text).toContain('status: delivered');
  });

  it('replaces an existing branch rather than appending a second', () => {
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- status: open, branch: feature/old -->\n',
      'slug', 'in-progress', null, 'feature/new',
    );
    expect(text).toContain('branch: feature/new');
    expect(text).not.toContain('feature/old');
    expect(text.match(/branch:/g)).toHaveLength(1);
  });

  it('leaves items for other plans untouched', () => {
    const two = '- [ ] [alpha] A\n- [ ] [beta] B\n';
    const { text } = withSprintAnnotation(two, 'alpha', 'delivered', null, '');
    expect(text).toContain('- [ ] [beta] B');
  });

  it('REPLACES an existing pr rather than adding a second', () => {
    // The other arm of the same branch: an annotation that already names a PR
    // has that number rewritten, not a duplicate key appended.
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- pr: #7, status: open -->\n',
      'slug', 'delivered', 99, '',
    );
    expect(text).toContain('pr: #99');
    expect(text).not.toContain('#7');
    expect(text.match(/pr:/g)).toHaveLength(1);
  });

  it('ADDS a branch to an annotation that carries none', () => {
    // And the matching arm for branch: absent means append, not replace.
    const { text } = withSprintAnnotation(
      '- [ ] [slug] Thing <!-- status: open -->\n',
      'slug', 'in-progress', null, 'feature/new',
    );
    expect(text).toContain('branch: feature/new');
    expect(text.match(/branch:/g)).toHaveLength(1);
  });

  it('reports false when nothing changed', () => {
    const { text, wrote } = withSprintAnnotation(
      '- [ ] [other] Thing\n', 'slug', 'delivered', null, '',
    );
    expect(wrote).toBe(false);
    expect(text).toBe('- [ ] [other] Thing\n');
  });
});

describe('the paths a write touches are derived, never listed', () => {
  // The sandbox tier diffs the filesystem against this enumeration, so a write
  // missing from it is a change nothing accounts for.
  it.each([
    ['plan-phase', { kind: 'plan-phase', file: 'docs/plans/p.md', phase: 'Approved' }, ['docs/plans/p.md']],
    ['plan-record', { kind: 'plan-record', file: 'docs/plans/p.md', field: 'Delivered', value: 'x' }, ['docs/plans/p.md']],
    ['hold-clear', { kind: 'hold-clear', branch: 'feature/x' }, [HOLD_FILE]],
    ['index-move', { kind: 'index-move', from: 'a/x.md', to: 'b/x.md' }, ['a/x.md', 'b/x.md']],
  ])('%s names its file(s)', (_label, write, expected) => {
    expect([...pathsOf(write as unknown as Write)]).toEqual(expected);
  });

  it.each([
    ['sprint-note', { kind: 'sprint-note', file: 'docs/sprints/s.md', note: 'n' }, ['docs/sprints/s.md']],
    ['brief', { kind: 'brief', file: '.plot/briefs/b.md', body: 'x' }, ['.plot/briefs/b.md']],
    ['commit', { kind: 'commit', paths: ['a.md', 'b.md'], message: 'm' }, ['a.md', 'b.md']],
  ])('%s names its file(s) too', (_label, write, expected) => {
    // The remaining arms of the switch. A write kind that falls through to the
    // default silently reports NO path, which the sandbox tier would read as
    // "this write touched nothing" — a change nothing accounts for.
    expect([...pathsOf(write as unknown as Write)]).toEqual(expected);
  });

  it.each([
    ['plan-annotation', { kind: 'plan-annotation', file: 'docs/plans/p.md', text: 't' }, ['docs/plans/p.md']],
    ['sprint-annotation', { kind: 'sprint-annotation', file: 'docs/sprints/s.md', plan: 'p', status: 'x' }, ['docs/sprints/s.md']],
  ])('%s names its file too', (_label, write, expected) => {
    expect([...pathsOf(write as unknown as Write)]).toEqual(expected);
  });

  it('reports NO path for a write the filesystem cannot see', () => {
    // Merging a PR, starting a worker, signalling one: those reach the host or
    // the process table, and the filesystem must not be asked to account for
    // them. Reporting a path here would make the sandbox diff fail on a change
    // that was never a file.
    expect([...pathsOf({ kind: 'pr-merge', pr: 7 } as unknown as Write)]).toEqual([]);
  });
});

describe('a decision names its paths once, in a stable order', () => {
  const decision = (writes: unknown[]): Decision<unknown> =>
    ({ writes, verdict: 'ok' } as unknown as Decision<unknown>);

  it('deduplicates and sorts', () => {
    // Sorted so two runs compare directly; deduplicated so a plan written twice
    // is one path, not two.
    const paths = pathsNamedBy(decision([
      { kind: 'plan-phase', file: 'docs/plans/b.md', phase: 'Approved' },
      { kind: 'plan-record', file: 'docs/plans/b.md', field: 'Approved', value: 'x' },
      { kind: 'plan-phase', file: 'docs/plans/a.md', phase: 'Approved' },
    ]));
    expect([...paths]).toEqual(['docs/plans/a.md', 'docs/plans/b.md']);
  });

  it("includes the commit's own paths, so a disagreement is visible", () => {
    // The union of what the decision says it STAGES and what its other writes
    // TOUCH. A commit that forgets a path its siblings wrote shows up here as
    // the two disagreeing, rather than as a file quietly left unstaged.
    const paths = pathsNamedBy(decision([
      { kind: 'plan-phase', file: 'docs/plans/a.md', phase: 'Approved' },
      { kind: 'commit', paths: ['docs/plans/a.md', 'docs/sprints/s.md'], message: 'm' },
    ]));
    expect([...paths]).toEqual(['docs/plans/a.md', 'docs/sprints/s.md']);
  });

  it('reports nothing for a decision that touches no file', () => {
    expect([...pathsNamedBy(decision([]))]).toEqual([]);
  });
});
