import { describe, it, expect } from 'vitest';
import {
  prGate,
  changesetGate,
  cleanTreeGate,
  notBlockedGate,
  planAnnotatedGate,
  gateFailures,
  passesGates,
  ALL_GATES,
  type DeskReadings,
} from '../src/rules/gates.js';

/**
 * The marker is assembled from `'<!' + '--'` rather than written literally, for
 * the same reason `changeset.test.ts` does it: a literal opens a comment for
 * any tool reading this file the way `plot-plan-meta.sh` does.
 */
const OPEN = '<!' + '--';
const CLOSE = '--' + '>';

const WORKSPACE = ['plot', '@plot-pm/board', '@plot-pm/domain'];

/** A changeset with its description first and the bumps block last. */
const GOOD_CHANGESET = [
  '---',
  "'plot': patch",
  '---',
  '',
  'The five gates read what a finished agent left behind.',
  '',
  OPEN,
  'bumps:',
  '  skills:',
  '    plot: patch',
  CLOSE,
  '',
].join('\n');

/**
 * A desk that passed every gate — the base case, on purpose.
 *
 * Every test below names the ONE reading it changes, so what triggers a failure
 * is visible in the test rather than buried in the fixture.
 */
const finished = (over: Partial<DeskReadings> = {}): DeskReadings => ({
  branch: 'feature/one',
  merge: 'merged',
  changesets: [{ path: '.changeset/tidy-moons.md', text: GOOD_CHANGESET }],
  workspacePackages: WORKSPACE,
  dirtyPath: '',
  blockedMarker: '',
  planLine: { prs: [609], deferred: false, deferredReason: '' },
  ...over,
});

describe('the gates — a desk that finished everything', () => {
  it('passes all five, and each one alone', () => {
    expect(gateFailures(finished())).toEqual([]);
    expect(passesGates(finished())).toBe(true);
    for (const gate of ALL_GATES) {
      expect(gate(finished())).toBeNull();
    }
  });

  it('runs exactly the five gates the plan names', () => {
    expect(ALL_GATES).toHaveLength(5);
  });
});

describe('prGate — the host is asked, and its silence is not permission', () => {
  it('passes a branch whose PR merged', () => {
    expect(prGate(finished({ merge: 'merged' }))).toBeNull();
  });

  it('fails a branch the host holds no merged PR for, and says to open one', () => {
    const failure = prGate(finished({ merge: 'not-merged' }));
    expect(failure).toContain('No merged PR for `feature/one`');
    expect(failure).toContain('open a PR');
  });

  it('fails an unreachable host, and says the question failed rather than answered no', () => {
    // `unreachable` and `not-merged` reach the same verdict by different
    // readings. A correction that confuses them tells an agent to open a PR it
    // may already have opened, so the two messages must not be one.
    const failure = prGate(finished({ merge: 'unreachable' }));
    expect(failure).toContain('could not be asked');
    expect(failure).toContain('not a report that no PR exists');
  });

  it('tells the two refusals apart — the same verdict, two different messages', () => {
    const unreachable = prGate(finished({ merge: 'unreachable' }));
    const notMerged = prGate(finished({ merge: 'not-merged' }));
    expect(unreachable).not.toBeNull();
    expect(notMerged).not.toBeNull();
    expect(unreachable).not.toEqual(notMerged);
  });
});

describe('changesetGate — every problem the rule returns, not the first', () => {
  it('passes a changeset whose description is prose and whose package exists', () => {
    expect(changesetGate(finished())).toBeNull();
  });

  it('fails a desk that added none, and says where the description goes', () => {
    const failure = changesetGate(finished({ changesets: [] }));
    expect(failure).toContain('No changeset was added');
    expect(failure).toContain('description FIRST');
  });

  it('fails an unknown package, naming the bad name and the valid ones', () => {
    const named = [
      '---',
      "'@plot-pm/plot': patch",
      '---',
      '',
      'A description long enough to be published.',
      '',
    ].join('\n');
    const failure = changesetGate(
      finished({ changesets: [{ path: '.changeset/wild-pans.md', text: named }] }),
    );
    expect(failure).toContain('@plot-pm/plot');
    expect(failure).toContain('@plot-pm/domain');
    expect(failure).toContain('.changeset/wild-pans.md');
  });

  it('fails a bumps block written first, quoting the line that would ship', () => {
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
      'The description nobody would ever read.',
      '',
    ].join('\n');
    const failure = changesetGate(
      finished({ changesets: [{ path: '.changeset/late-prose.md', text: commentFirst }] }),
    );
    expect(failure).toContain('would publish no description');
    expect(failure).toContain(OPEN);
  });

  it('reports BOTH problems of one file rather than stopping at the first', () => {
    const both = ['---', "'plot-deliver': patch", '---', '', 'wip', ''].join('\n');
    const failure = changesetGate(
      finished({ changesets: [{ path: '.changeset/two-faults.md', text: both }] }),
    );
    expect(failure).toContain('plot-deliver');
    expect(failure).toContain('would publish no description');
    // Two bullets, one per problem — a gate that returned the first would have one.
    expect(failure?.split('\n- ')).toHaveLength(3);
  });

  it('reports problems across every file, not only the first file', () => {
    const bad = ['---', "'nope': patch", '---', '', 'A description long enough to publish.', ''].join(
      '\n',
    );
    const failure = changesetGate(
      finished({
        changesets: [
          { path: '.changeset/a.md', text: bad },
          { path: '.changeset/b.md', text: bad },
        ],
      }),
    );
    expect(failure).toContain('.changeset/a.md');
    expect(failure).toContain('.changeset/b.md');
  });
});

describe('cleanTreeGate — uncommitted work exists in exactly one place', () => {
  it('passes a clean tree', () => {
    expect(cleanTreeGate(finished({ dirtyPath: '' }))).toBeNull();
  });

  it('fails a dirty tree and quotes the path, which a boolean could not', () => {
    const failure = cleanTreeGate(finished({ dirtyPath: '?? packages/domain/src/rules/gates.ts' }));
    expect(failure).toContain('?? packages/domain/src/rules/gates.ts');
    expect(failure).toContain('only copy');
  });
});

describe('notBlockedGate — a marker is a question, and it names the file', () => {
  it('passes a desk carrying no marker', () => {
    expect(notBlockedGate(finished({ blockedMarker: '' }))).toBeNull();
  });

  it('fails a blocked desk and names the file holding the question', () => {
    const failure = notBlockedGate(finished({ blockedMarker: 'PLOT-BLOCKED.md' }));
    expect(failure).toContain('PLOT-BLOCKED.md');
    expect(failure).toContain('delete it');
  });
});

describe('planAnnotatedGate — the plan is the ledger', () => {
  it('passes a line annotated with a PR number', () => {
    expect(planAnnotatedGate(finished())).toBeNull();
  });

  it('passes a deferred line that says what it was given up for', () => {
    expect(
      planAnnotatedGate(
        finished({ planLine: { prs: [], deferred: true, deferredReason: 'gated on a measurement' } }),
      ),
    ).toBeNull();
  });

  it('fails a deferred line with no reason — the marker without the decision', () => {
    const failure = planAnnotatedGate(
      finished({ planLine: { prs: [], deferred: true, deferredReason: '' } }),
    );
    expect(failure).toContain('deferred');
    expect(failure).toContain('gives no reason');
  });

  it('fails an unannotated line, and says what to append and where', () => {
    const failure = planAnnotatedGate(
      finished({ planLine: { prs: [], deferred: false, deferredReason: '' } }),
    );
    expect(failure).toContain('not annotated');
    expect(failure).toContain('main');
  });

  it('fails a branch no plan names, which is a different fault from an empty line', () => {
    // A branch nobody planned against a branch nobody wrote down. Both fail,
    // and the repairs differ: one adds a line, the other fills it.
    const missing = planAnnotatedGate(finished({ planLine: null }));
    const empty = planAnnotatedGate(
      finished({ planLine: { prs: [], deferred: false, deferredReason: '' } }),
    );
    expect(missing).toContain('No plan names');
    expect(missing).not.toEqual(empty);
  });
});

describe('gateFailures — one correction naming everything', () => {
  it('reports every failed gate, not the first', () => {
    const failures = gateFailures(
      finished({
        merge: 'not-merged',
        changesets: [],
        dirtyPath: 'src/x.ts',
        blockedMarker: 'PLOT-BLOCKED.md',
        planLine: null,
      }),
    );
    expect(failures).toHaveLength(5);
    expect(passesGates(finished({ merge: 'not-merged' }))).toBe(false);
  });

  it('orders the marker first and the uncommitted path second', () => {
    // A person clears the marker; only the agent can commit. The order is what
    // a reader acts on first.
    const failures = gateFailures(
      finished({ merge: 'not-merged', dirtyPath: 'src/x.ts', blockedMarker: 'PLOT-BLOCKED.md' }),
    );
    expect(failures[0]).toContain('PLOT-BLOCKED.md');
    expect(failures[1]).toContain('src/x.ts');
    expect(failures[2]).toContain('No merged PR');
  });

  it('runs only the gates it is given', () => {
    const readings = finished({ merge: 'not-merged', dirtyPath: 'src/x.ts' });
    expect(gateFailures(readings, [cleanTreeGate])).toHaveLength(1);
    expect(passesGates(readings, [changesetGate])).toBe(true);
  });
});

describe('the failure text reads as a prompt', () => {
  /**
   * Read aloud, per the plan's `Done when`. Each message names the branch,
   * states what is missing, and gives an instruction — so a correction prompt
   * built from it tells the next attempt what to do rather than what went
   * wrong.
   */
  it('every failure names the branch and ends in a full stop', () => {
    const failures = gateFailures(
      finished({
        merge: 'unreachable',
        changesets: [],
        dirtyPath: 'src/x.ts',
        blockedMarker: 'PLOT-BLOCKED.md',
        planLine: { prs: [], deferred: false, deferredReason: '' },
      }),
    );
    expect(failures).toHaveLength(5);
    for (const failure of failures) {
      expect(failure).toContain('feature/one');
      expect(failure.trim().endsWith('.')).toBe(true);
      // An instruction, not a verdict: every message tells the reader to act.
      expect(failure.length).toBeGreaterThan(60);
    }
  });
});
