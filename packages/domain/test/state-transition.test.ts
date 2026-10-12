import { describe, expect, it } from 'vitest';

import {
  effectivePaths,
  lifecycleKindOf,
  normalizedPath,
  owningCommand,
  slugOf,
  sprintVerb,
  renamedFromOf,
  stateTransitionOf,
  stateTransitionRefusal,
  stateTransitionsOf,
  statusStateOf,
  takesModifiedOf,
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

  it('finds an added State line: a transition from none', () => {
    expect(at('# P\n', doc('Draft'))).toMatchObject({ before: '', after: 'Draft' });
  });

  it('finds a removed State line: a transition to none', () => {
    expect(at(doc('Draft'), '# P\n\n## Status\n')).toMatchObject({ before: 'Draft', after: '' });
  });

  it('passes a HEAD version and a working copy that both hold no State value', () => {
    expect(at('# P\n', '# P\n\nmore\n')).toBeNull();
  });

  it('reads a deleted same-slug file as the before of a creation', () => {
    const renamed = { path: 'docs/plans/2025-12-01-x.md', head: doc('Design') };
    expect(stateTransitionOf('docs/plans/2026-01-01-x.md', 'plan', null, doc('Approved'), renamed)).toEqual({
      path: 'docs/plans/2026-01-01-x.md',
      kind: 'plan',
      before: 'Design',
      after: 'Approved',
      renamedFrom: 'docs/plans/2025-12-01-x.md',
    });
  });

  it('passes a rename that keeps the value', () => {
    const renamed = { path: 'docs/plans/2025-12-01-x.md', head: doc('Design') };
    expect(stateTransitionOf('docs/plans/2026-01-01-x.md', 'plan', null, doc('Design'), renamed)).toBeNull();
  });

  it('passes an unchanged value while the rest of the file changes', () => {
    expect(at(doc('Draft'), `${doc('Draft')}\n## Notes\n\nmore\n`)).toBeNull();
  });

  it('finds a value no lifecycle admits', () => {
    expect(at(doc('Draft'), doc('Planned'))?.after).toBe('Planned');
  });
});

describe('renamedFromOf', () => {
  const old = (path: string) => ({ path, head: doc('Design') });
  const find = (path: string, deleted: ReturnType<typeof old>[]) =>
    renamedFromOf(path, 'plan', deleted, 'docs/plans/', 'docs/sprints/');

  it('finds the deleted file with the same slug under another date', () => {
    expect(find('docs/plans/2026-02-02-x.md', [old('docs/plans/2026-01-01-x.md')])?.path).toBe(
      'docs/plans/2026-01-01-x.md',
    );
  });

  it('ignores a deletion with another slug', () => {
    expect(find('docs/plans/2026-02-02-x.md', [old('docs/plans/2026-01-01-y.md')])).toBeNull();
  });

  it('ignores a deletion of another kind', () => {
    expect(find('docs/plans/2026-02-02-x.md', [old('docs/sprints/2026-W01-x.md')])).toBeNull();
  });
});

describe('stateTransitionsOf', () => {
  const file = (text: string) => ({ text, link: false });
  const link = (target: string) => ({ text: target, link: true });
  const read = (
    path: string,
    head: { text: string; link: boolean } | null,
    committed: { text: string; link: boolean } | null,
  ) => ({ path, kind: 'plan' as const, head, committed });
  const of = (...readings: ReturnType<typeof read>[]) => stateTransitionsOf(readings, 'docs/plans/', 'docs/sprints/');

  it('finds a changed value', () => {
    expect(of(read('docs/plans/2026-01-01-x.md', file(doc('Draft')), file(doc('Approved'))))).toEqual([
      { path: 'docs/plans/2026-01-01-x.md', kind: 'plan', before: 'Draft', after: 'Approved' },
    ]);
  });

  it('reads a deleted same-slug plan as the before of an added one', () => {
    expect(
      of(
        read('docs/plans/2026-01-01-x.md', file(doc('Design')), null),
        read('docs/plans/2026-02-02-x.md', null, file(doc('Draft'))),
      ),
    ).toEqual([
      {
        path: 'docs/plans/2026-02-02-x.md',
        kind: 'plan',
        before: 'Design',
        after: 'Draft',
        renamedFrom: 'docs/plans/2026-01-01-x.md',
      },
    ]);
  });

  it('passes a symlink added, removed or moved between index directories', () => {
    expect(of(read('docs/plans/active/x.md', null, link('../2026-01-01-x.md')))).toEqual([]);
    expect(of(read('docs/plans/active/x.md', link('../2026-01-01-x.md'), null))).toEqual([]);
    expect(
      of(
        read('docs/plans/delivered/x.md', link('../2026-01-01-x.md'), null),
        read('docs/plans/active/x.md', null, link('../2026-01-01-x.md')),
      ),
    ).toEqual([]);
  });

  it('never reads a deleted symlink as the before of an added plan', () => {
    expect(
      of(read('docs/plans/active/x.md', link('../2026-01-01-x.md'), null), read('docs/plans/2026-02-02-x.md', null, file(doc('Draft')))),
    ).toEqual([]);
  });

  it('never reads an added symlink as a rename of a deleted plan', () => {
    expect(
      of(read('docs/plans/2026-01-01-x.md', file(doc('Design')), null), read('docs/plans/active/x.md', null, link('../2026-01-01-x.md'))),
    ).toEqual([]);
  });

  it('reads a plan that replaces a symlink as a creation', () => {
    expect(of(read('docs/plans/2026-01-01-x.md', link('elsewhere.md'), file(doc('Draft'))))).toEqual([]);
  });

  it('reads a symlink that replaces a plan as a deletion', () => {
    expect(of(read('docs/plans/2026-01-01-x.md', file(doc('Draft')), link('elsewhere.md')))).toEqual([]);
  });
});

describe('takesModifiedOf', () => {
  it('reads -a, -am and --all as taking the modified tracked files', () => {
    expect(takesModifiedOf('git commit -a -m x')).toBe(true);
    expect(takesModifiedOf('git commit -am x')).toBe(true);
    expect(takesModifiedOf('git commit -m x -a')).toBe(true);
    expect(takesModifiedOf('git commit -m x -am')).toBe(true);
    expect(takesModifiedOf('git commit --all -m x')).toBe(true);
  });

  it('reads -am with the message quoted against it', () => {
    expect(takesModifiedOf('git commit -am"msg"')).toBe(true);
    expect(takesModifiedOf("git commit -am'msg'")).toBe(true);
    expect(takesModifiedOf('git commit -a"msg"')).toBe(true);
  });

  it('reads -a before a newline, and at the start of the text', () => {
    expect(takesModifiedOf('git commit -a\n')).toBe(true);
    expect(takesModifiedOf('-a')).toBe(true);
  });

  it('reads a plain commit, and a flag that only starts with -a, as the index only', () => {
    expect(takesModifiedOf('git commit -m x')).toBe(false);
    expect(takesModifiedOf('git commit --amend -m x')).toBe(false);
    expect(takesModifiedOf('git commit -m x-am')).toBe(false);
  });
});

describe('normalizedPath', () => {
  it('drops . and empty segments and resolves ..', () => {
    expect(normalizedPath('./docs//plans/./p.md')).toBe('docs/plans/p.md');
    expect(normalizedPath('sub/../docs/plans/p.md')).toBe('docs/plans/p.md');
  });

  it('normalises the root, and a .. above it, to the empty string', () => {
    expect(normalizedPath('.')).toBe('');
    expect(normalizedPath('sub/..')).toBe('');
    expect(normalizedPath('../..')).toBe('');
  });
});

describe('effectivePaths', () => {
  const readings = {
    staged: ['docs/plans/s.md', 'b.md'],
    workingChanges: ['docs/plans/w.md', 'docs/plans/s.md', 'a.md'],
    showPrefix: '',
  };
  const at = (showPrefix: string) => ({ ...readings, showPrefix });

  it('carries the staged text of each staged path for a plain commit, sorted', () => {
    expect(effectivePaths(readings, 'git commit -m x')).toEqual([
      { path: 'b.md', carries: 'index' },
      { path: 'docs/plans/s.md', carries: 'index' },
    ]);
  });

  it('carries every working copy for -a, and the staged text of a path with no working change', () => {
    expect(effectivePaths(readings, 'git commit -am"msg"')).toEqual([
      { path: 'a.md', carries: 'working' },
      { path: 'b.md', carries: 'index' },
      { path: 'docs/plans/s.md', carries: 'working' },
      { path: 'docs/plans/w.md', carries: 'working' },
    ]);
  });

  it('carries every working copy for a chained tree flag', () => {
    for (const flag of ['-A', '--all', '.', '-u', '--update']) {
      const carried = effectivePaths(readings, `git add ${flag} && git commit -m x`);
      expect(carried.filter((entry) => entry.carries === 'working').map((entry) => entry.path)).toEqual([
        'a.md',
        'docs/plans/s.md',
        'docs/plans/w.md',
      ]);
    }
  });

  it('carries every working copy for a glob pathspec', () => {
    for (const spec of ['docs/plans/*.md', 'docs/plans/?.md', 'docs/plans/[sw].md']) {
      const carried = effectivePaths(readings, `git add ${spec} && git commit -m x`);
      expect(carried.map((entry) => entry.path)).toContain('docs/plans/w.md');
    }
  });

  it('carries every working copy for an absolute pathspec, quoted or not', () => {
    for (const spec of ['/repo/docs/plans/w.md', '"/repo/docs/plans/w.md"']) {
      expect(effectivePaths(readings, `git add ${spec} && git commit -m x`)).toContainEqual({
        path: 'docs/plans/w.md',
        carries: 'working',
      });
    }
  });

  it('carries what a directory pathspec holds, and nothing beside it', () => {
    expect(effectivePaths(readings, 'git add docs/plans && git commit -m x')).toEqual([
      { path: 'b.md', carries: 'index' },
      { path: 'docs/plans', carries: 'working' },
      { path: 'docs/plans/s.md', carries: 'working' },
      { path: 'docs/plans/w.md', carries: 'working' },
    ]);
  });

  it('carries a literal pathspec under the show-prefix, normalised and unquoted', () => {
    expect(effectivePaths(at('sub/'), "git add ../docs/plans/w.md './x.md' && git commit -m x")).toEqual([
      { path: 'b.md', carries: 'index' },
      { path: 'docs/plans/s.md', carries: 'index' },
      { path: 'docs/plans/w.md', carries: 'working' },
      { path: 'sub/x.md', carries: 'working' },
    ]);
  });

  it('carries every working copy for a pathspec that normalises to the root', () => {
    expect(
      effectivePaths(at('sub/'), 'git add .. && git commit -m x').filter((entry) => entry.carries === 'working'),
    ).toHaveLength(3);
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

  it('names a removal, an addition and a rename', () => {
    const text = stateTransitionRefusal([
      { path: 'docs/plans/2026-01-01-x.md', kind: 'plan', before: 'Design', after: '' },
      { path: 'docs/plans/2026-01-01-y.md', kind: 'plan', before: '', after: 'Approved' },
      { path: 'docs/plans/2026-02-02-z.md', kind: 'plan', before: 'Design', after: 'Approved', renamedFrom: 'docs/plans/2026-01-01-z.md' },
    ]);
    expect(text).toContain('Design -> (line removed), written by hand.');
    expect(text).toContain("No command removes a 'State:' line");
    expect(text).toContain('(no State line) -> Approved, written by hand.');
    expect(text).toContain('Design -> Approved, written by hand (renamed from docs/plans/2026-01-01-z.md).');
  });
});
