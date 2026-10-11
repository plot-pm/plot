import { describe, expect, it } from 'vitest';

import {
  commitStagingOf,
  lifecycleKindOf,
  owningCommand,
  slugOf,
  sprintVerb,
  stateTransitionOf,
  stateTransitionRefusal,
  statusStateOf,
} from '../src/rules/state-transition.js';

const doc = (state: string): string => `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n`;

describe('statusStateOf', () => {
  it('reads the State value in the Status section', () => {
    expect(statusStateOf(doc('Approved'))).toBe('Approved');
  });

  it('reads the legacy Phase key', () => {
    expect(statusStateOf('## Status\n\nPhase: Draft  \n')).toBe('Draft');
  });

  it('reads a bare, unbolded line', () => {
    expect(statusStateOf('## Status\nstate: Active\n')).toBe('Active');
  });

  it('ignores a State line quoted in another section', () => {
    expect(statusStateOf('## Notes\n\n- **State:** Delivered\n\n## Status\n\n- **State:** Draft\n')).toBe('Draft');
  });

  it('returns the empty string when the Status section holds no State line', () => {
    expect(statusStateOf('## Notes\n\n- **State:** Delivered\n\n## Status\n\n- **Type:** feature\n')).toBe('');
    expect(statusStateOf('')).toBe('');
  });

  it('takes the first match', () => {
    expect(statusStateOf('## Status\n- State: A\n- State: B\n')).toBe('A');
  });
});

describe('lifecycleKindOf', () => {
  it('names a plan and a sprint by directory, tolerating a trailing slash in the config', () => {
    expect(lifecycleKindOf('docs/plans/2026-01-01-x.md', 'docs/plans/', 'docs/sprints/')).toBe('plan');
    expect(lifecycleKindOf('docs/plans/active/x.md', 'docs/plans', 'docs/sprints')).toBe('plan');
    expect(lifecycleKindOf('docs/sprints/2026-W01-s.md', 'docs/plans/', 'docs/sprints/')).toBe('sprint');
  });

  it('names no kind for any other path', () => {
    expect(lifecycleKindOf('docs/plans-extra/x.md', 'docs/plans/', 'docs/sprints/')).toBeNull();
    expect(lifecycleKindOf('README.md', 'docs/plans/', 'docs/sprints/')).toBeNull();
  });
});

describe('slugOf', () => {
  it('cuts a plan at three dashes and a sprint at two', () => {
    expect(slugOf('plan', 'docs/plans/2026-01-01-the-x-y.md')).toBe('the-x-y');
    expect(slugOf('sprint', 'docs/sprints/2026-W01-s.md')).toBe('s');
  });

  it('returns what is left when the name has fewer dashes than the cut', () => {
    expect(slugOf('plan', 'docs/plans/odd.md')).toBe('odd');
    expect(slugOf('sprint', 'docs/sprints/2026-W01.md')).toBe('W01');
  });
});

describe('sprintVerb and owningCommand', () => {
  it('maps a sprint state to its verb, committing for any other', () => {
    expect(sprintVerb('Active')).toBe('start');
    expect(sprintVerb('closed')).toBe('close');
    expect(sprintVerb('Committed')).toBe('commit');
    expect(sprintVerb('Planned')).toBe('commit');
  });

  it('names /plot-approve for Approved and /plot-deliver for Delivered', () => {
    expect(owningCommand('plan', 'x', 'Approved')).toBe('/plot-approve x  (or: bash skills/plot/scripts/plot-approve.sh x)');
    expect(owningCommand('plan', 'x', 'delivered')).toBe('/plot-deliver x  (or: bash skills/plot/scripts/plot-deliver.sh x)');
  });

  it('names the sprint command with its verb', () => {
    expect(owningCommand('sprint', 's', 'Active')).toBe(
      '/plot-sprint s start  (or: bash skills/plot/scripts/plot-sprint-state.sh s Active)',
    );
  });

  it('names the lifecycle for a state no command writes', () => {
    const text = owningCommand('plan', 'x', 'Planned');
    expect(text).toContain('Draft > Approved > Delivered > Released');
    expect(text).toContain("no command writes 'Planned'");
  });
});

describe('stateTransitionOf', () => {
  const at = (head: string | null, working: string | null) =>
    stateTransitionOf('docs/plans/2026-01-01-x.md', 'plan', head, working);

  it('finds a changed value', () => {
    expect(at(doc('Draft'), doc('Approved'))).toEqual({
      path: 'docs/plans/2026-01-01-x.md',
      kind: 'plan',
      before: 'Draft',
      after: 'Approved',
    });
  });

  it('passes a creation: no HEAD version', () => {
    expect(at(null, doc('Draft'))).toBeNull();
  });

  it('passes a working copy that cannot be read', () => {
    expect(at(doc('Draft'), null)).toBeNull();
  });

  it('passes a HEAD version with no State value', () => {
    expect(at('# P\n', doc('Draft'))).toBeNull();
  });

  it('passes a deleted State line', () => {
    expect(at(doc('Draft'), '# P\n\n## Status\n')).toBeNull();
  });

  it('passes an unchanged value while the rest of the file changes', () => {
    expect(at(doc('Draft'), `${doc('Draft')}\n## Notes\n\nmore\n`)).toBeNull();
  });

  it('finds a value no lifecycle admits', () => {
    expect(at(doc('Draft'), doc('Planned'))?.after).toBe('Planned');
  });
});

describe('commitStagingOf', () => {
  it('reads a plain commit as carrying the index only', () => {
    expect(commitStagingOf('git commit -m x')).toEqual({ takesModified: false, addsTree: false, addedPaths: [] });
  });

  it('reads -a, -am and --all as taking the modified tracked files', () => {
    expect(commitStagingOf('git commit -a -m x').takesModified).toBe(true);
    expect(commitStagingOf('git commit -am x').takesModified).toBe(true);
    expect(commitStagingOf('git commit -m x -a').takesModified).toBe(true);
    expect(commitStagingOf('git commit -m x -am').takesModified).toBe(true);
    expect(commitStagingOf('git commit --all -m x').takesModified).toBe(true);
  });

  it('reads a chained git add of the whole tree', () => {
    for (const flag of ['-A', '--all', '-a', '.', '-u', '--update']) {
      expect(commitStagingOf(`git add ${flag} && git commit -m x`).addsTree).toBe(true);
    }
  });

  it('collects the literal paths of every chained git add, skipping flags', () => {
    expect(commitStagingOf('git add -f a.md b.md; git add c.md | git commit -m x').addedPaths).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('ignores a segment without git add', () => {
    expect(commitStagingOf('echo git add x\ngit commit -m y').addedPaths).toEqual(['x']);
    expect(commitStagingOf('git status && git commit -m "git add"').addedPaths).toEqual(['"']);
  });
});

describe('stateTransitionRefusal', () => {
  it('allows when no transition is uncleared', () => {
    expect(stateTransitionRefusal([])).toBeNull();
  });

  it('names each file, its transition and the owning command', () => {
    const text = stateTransitionRefusal([
      { path: 'docs/plans/2026-01-01-x.md', kind: 'plan', before: 'Approved', after: 'Delivered' },
      { path: 'docs/sprints/2026-W01-s.md', kind: 'sprint', before: 'Committed', after: 'Active' },
    ]);
    expect(text).toContain('a lifecycle field has one writer');
    expect(text).toContain('Approved -> Delivered, written by hand.');
    expect(text).toContain('/plot-deliver x');
    expect(text).not.toContain('/plot-approve x');
    expect(text).toContain('/plot-sprint s start');
    expect(text).toContain('a missing transition is the gap');
  });
});
