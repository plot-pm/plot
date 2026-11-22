import { describe, expect, it } from 'vitest';
import { linkIconKind, type LinkTarget } from '../src/index.js';

describe('linkIconKind', () => {
  it('names each kind of place a link leads to', () => {
    expect(linkIconKind('plan')).toBe('plan');
    expect(linkIconKind('slice')).toBe('slice');
    expect(linkIconKind('branch')).toBe('branch');
    expect(linkIconKind('pr')).toBe('pr');
    expect(linkIconKind('ticket')).toBe('ticket');
    expect(linkIconKind('story')).toBe('story');
    expect(linkIconKind('sprint')).toBe('sprint');
    expect(linkIconKind('release')).toBe('release');
    expect(linkIconKind('worktree')).toBe('worktree');
    expect(linkIconKind('agent')).toBe('agent');
    expect(linkIconKind('build')).toBe('build');
    expect(linkIconKind('external')).toBe('external');
  });

  it('reads the other vocabularies as the kind they point at', () => {
    expect(linkIconKind('wave')).toBe('slice');
    expect(linkIconKind('desk')).toBe('worktree');
    expect(linkIconKind('issue')).toBe('ticket');
    expect(linkIconKind('compare')).toBe('branch');
    expect(linkIconKind('plan-pr')).toBe('pr');
    expect(linkIconKind('review')).toBe('pr');
    expect(linkIconKind('checks')).toBe('build');
    expect(linkIconKind('ci-run')).toBe('build');
    expect(linkIconKind('person')).toBe('agent');
    expect(linkIconKind('url')).toBe('external');
  });

  it('answers null for a target that names no kind of place', () => {
    expect(linkIconKind('action')).toBeNull();
    expect(linkIconKind('menu')).toBeNull();
    expect(linkIconKind('question')).toBeNull();
    expect(linkIconKind('log')).toBeNull();
    expect(linkIconKind('item')).toBeNull();
  });

  it('reads a cell link target by its `to`', () => {
    const targets: LinkTarget[] = [
      { to: 'pr', pr: 7 },
      { to: 'branch', branch: 'feature/x' },
      { to: 'plan', plan: 'p', slice: null },
      { to: 'action', action: 'approve', id: 'p' },
    ];
    expect(targets.map(linkIconKind)).toEqual(['pr', 'branch', 'plan', null]);
  });
});
