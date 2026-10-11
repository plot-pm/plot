import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BRANCH_PREFIXES,
  addedOrRenamed,
  briefComputedPath,
  briefNameRefusal,
  briefPrefixesOf,
  chainedStagesOf,
} from '../src/rules/brief-name.js';

const defaults = briefPrefixesOf('');

describe('briefPrefixesOf', () => {
  it('drops the slash and the whitespace from each entry', () => {
    expect(briefPrefixesOf('idea/, feature/ ,bug')).toEqual(['idea', 'feature', 'bug']);
  });

  it('reads an empty or blank value as the default list, never as no prefixes', () => {
    expect(briefPrefixesOf('')).toEqual(['idea', 'feature', 'bug', 'docs', 'infra']);
    expect(briefPrefixesOf('  \t ')).toEqual(briefPrefixesOf(DEFAULT_BRANCH_PREFIXES));
  });

  it('drops empty entries', () => {
    expect(briefPrefixesOf('idea/,,/')).toEqual(['idea']);
  });
});

describe('briefComputedPath', () => {
  it.each(['idea', 'feature', 'bug', 'docs', 'infra'])('refuses the default prefix %s-', (p) => {
    expect(briefComputedPath(`.plot/briefs/${p}-a-slug.md`, defaults)).toBe('.plot/briefs/a-slug.md');
  });

  it('passes the computed name', () => {
    expect(briefComputedPath('.plot/briefs/x.md', defaults)).toBeNull();
  });

  it('passes a prefix word with no dash, and a prefix with nothing after the dash', () => {
    expect(briefComputedPath('.plot/briefs/bugfix-parser.md', defaults)).toBeNull();
    expect(briefComputedPath('.plot/briefs/feature.md', defaults)).toBeNull();
    expect(briefComputedPath('.plot/briefs/infrastructure-map.md', defaults)).toBeNull();
    expect(briefComputedPath('.plot/briefs/feature-.md', defaults)).toBeNull();
  });

  it('passes a path outside the briefs directory, a non-md file, or one level deeper', () => {
    expect(briefComputedPath('docs/feature-x.md', defaults)).toBeNull();
    expect(briefComputedPath('.plot/briefs/feature-x.txt', defaults)).toBeNull();
    expect(briefComputedPath('.plot/briefs/sub/feature-x.md', defaults)).toBeNull();
  });

  it('judges only the configured prefixes', () => {
    const only = briefPrefixesOf('story/');
    expect(briefComputedPath('.plot/briefs/story-x.md', only)).toBe('.plot/briefs/x.md');
    expect(briefComputedPath('.plot/briefs/feature-x.md', only)).toBeNull();
  });
});

describe('chainedStagesOf', () => {
  it('reads a bare path after git add', () => {
    expect(chainedStagesOf('git add .plot/briefs/feature-x.md && git commit -m x', '')).toEqual({
      adds: ['.plot/briefs/feature-x.md'],
      moves: [],
    });
  });

  it('reads -A, --all and . as the whole tree, and skips other flags', () => {
    expect(chainedStagesOf('git add -A && git commit', '').adds).toEqual([null]);
    expect(chainedStagesOf('git add --all; git commit', '').adds).toEqual([null]);
    expect(chainedStagesOf('git add . | git commit', '').adds).toEqual([null]);
    expect(chainedStagesOf('git add -f a b && git commit', '').adds).toEqual(['a', 'b']);
  });

  it('reads the last argument of git mv as the destination, under the show-prefix', () => {
    expect(chainedStagesOf('git mv -k old.md ./new.md && git commit', 'sub/').moves).toEqual(['sub/new.md']);
  });

  it('reads neither from a command without them', () => {
    expect(chainedStagesOf('git commit -m x', '')).toEqual({ adds: [], moves: [] });
  });

  it('reads a git mv with no arguments as no destination', () => {
    expect(chainedStagesOf('git mv && git commit', '').moves).toEqual([]);
  });
});

describe('addedOrRenamed', () => {
  it('keeps an add and a rename destination and never a modify', () => {
    expect(
      addedOrRenamed([
        { status: 'added', path: 'a' },
        { status: 'modified', path: 'b' },
        { status: 'renamed', path: 'c' },
      ]),
    ).toEqual(['a', 'c']);
  });
});

describe('briefNameRefusal', () => {
  it('allows when nothing is misnamed', () => {
    expect(briefNameRefusal([])).toBeNull();
  });

  it('names the path, the computed path and the git mv for a tracked file', () => {
    const text = briefNameRefusal([
      { path: '.plot/briefs/infra-x.md', want: '.plot/briefs/x.md', tracked: true, wantExists: false },
    ]);
    expect(text).toContain('  .plot/briefs/infra-x.md');
    expect(text).toContain('Rename it:  git mv .plot/briefs/infra-x.md .plot/briefs/x.md');
    expect(text).not.toContain('already exists');
  });

  it('offers a plain mv for an untracked file and warns when the target exists', () => {
    const text = briefNameRefusal([
      { path: '.plot/briefs/bug-y.md', want: '.plot/briefs/y.md', tracked: false, wantExists: true },
    ]);
    expect(text).toContain('Rename it:  mv .plot/briefs/bug-y.md .plot/briefs/y.md');
    expect(text).toContain('.plot/briefs/y.md already exists — compare the two before replacing it.');
  });
});
