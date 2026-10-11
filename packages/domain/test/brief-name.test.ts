import { describe, expect, it } from 'vitest';

import type { StagedPath } from '../src/ports/refs.js';
import {
  DEFAULT_BRANCH_PREFIXES,
  type BriefNameReadings,
  addedOrRenamed,
  briefBranchOf,
  briefComputedPath,
  briefNameCandidates,
  briefNameRefusal,
  briefPrefixesOf,
  chainedStagesOf,
  misnamedBriefs,
} from '../src/rules/brief-name.js';
import { briefPath } from '../src/rules/brief-path.js';

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

  it('splits on newlines, so a git mv on its own line before the commit is read', () => {
    expect(
      chainedStagesOf('git mv .plot/briefs/feature-legacy.md .plot/briefs/docs-q.md\ngit commit -m msg', '').moves,
    ).toEqual(['.plot/briefs/docs-q.md']);
  });

  it('reads a git add and a git mv on separate lines, each as its own segment', () => {
    expect(
      chainedStagesOf('git add sub/keep.txt\ngit mv .plot/briefs/a.md .plot/briefs/docs-q.md\ngit commit -m msg', ''),
    ).toEqual({ adds: ['sub/keep.txt'], moves: ['.plot/briefs/docs-q.md'] });
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

const readings = (over: Partial<BriefNameReadings> = {}): BriefNameReadings => ({
  staged: [],
  untracked: [],
  moves: [],
  prefixes: defaults,
  inHead: new Set(),
  branches: new Set(),
  texts: new Map(),
  present: new Set(),
  ...over,
});

const added = (path: string): StagedPath => ({ status: 'added', path });

describe('briefNameCandidates', () => {
  it('unions the staged adds, the chained adds and the moves, sorted and once each, keeping only misnamed-looking briefs', () => {
    expect(
      briefNameCandidates({
        staged: [added('.plot/briefs/infra-b.md'), { status: 'modified', path: '.plot/briefs/feature-m.md' }],
        untracked: ['.plot/briefs/bug-a.md', '.plot/briefs/infra-b.md', 'src/x.ts'],
        moves: ['.plot/briefs/ok.md'],
        prefixes: defaults,
      }),
    ).toEqual([
      { path: '.plot/briefs/bug-a.md', want: '.plot/briefs/a.md' },
      { path: '.plot/briefs/infra-b.md', want: '.plot/briefs/b.md' },
    ]);
  });
});

describe('misnamedBriefs: the HEAD filter', () => {
  it('reads a chained add of a path HEAD holds as a modify and judges nothing', () => {
    expect(
      misnamedBriefs(readings({ untracked: ['.plot/briefs/feature-legacy.md'], inHead: new Set(['.plot/briefs/feature-legacy.md']) })),
    ).toEqual([]);
  });

  it('judges a chained add or move HEAD does not hold', () => {
    expect(misnamedBriefs(readings({ moves: ['.plot/briefs/docs-q.md'] }))).toEqual([
      { path: '.plot/briefs/docs-q.md', want: '.plot/briefs/q.md', tracked: false, wantExists: false },
    ]);
  });

  it('judges a staged add whatever inHead says, and marks it tracked', () => {
    expect(
      misnamedBriefs(
        readings({
          staged: [added('.plot/briefs/bug-y.md')],
          inHead: new Set(['.plot/briefs/bug-y.md']),
          present: new Set(['.plot/briefs/y.md']),
        }),
      ),
    ).toEqual([{ path: '.plot/briefs/bug-y.md', want: '.plot/briefs/y.md', tracked: true, wantExists: true }]);
  });
});

describe('briefBranchOf', () => {
  const path = '.plot/briefs/feature-y.md';

  it('names a known branch whose briefPath is the path, of any prefix or depth', () => {
    expect(briefBranchOf(path, readings({ branches: new Set(['main', 'feature/y', 'idea/feature-y']) }))).toBe('idea/feature-y');
    expect(briefBranchOf(path, readings({ branches: new Set(['release/team/feature-y']) }))).toBe('release/team/feature-y');
  });

  it('names a <prefix>/<stem> branch from the brief text', () => {
    const texts = new Map([[path, '- **Branch:** `idea/feature-y` (base: `main`)\n']]);
    expect(briefBranchOf(path, readings({ texts }))).toBe('idea/feature-y');
    expect(briefBranchOf(path, readings({ texts: new Map([[path, 'the branch is idea/feature-y.\n']]) }))).toBe('idea/feature-y');
  });

  it('names nothing from text that only holds the flattened branch, a longer name, a path or an unconfigured prefix', () => {
    for (const text of ['Branch: `feature/y`', 'idea/feature-y-more', 'idea/feature-y.md', 'x/idea/feature-y', 'docs/plans/feature-y', 'story/feature-y']) {
      expect(briefBranchOf(path, readings({ texts: new Map([[path, text]]) })), text).toBeNull();
    }
    expect(briefBranchOf(path, readings())).toBeNull();
  });

  it('escapes the stem and the prefixes as literal text', () => {
    const dotted = '.plot/briefs/feature-v1.2.md';
    expect(briefBranchOf(dotted, readings({ texts: new Map([[dotted, 'idea/feature-v1x2']]) }))).toBeNull();
    expect(briefBranchOf(dotted, readings({ texts: new Map([[dotted, 'idea/feature-v1.2']]) }))).toBe('idea/feature-v1.2');
    const odd = '.plot/briefs/a.b-x.md';
    const prefixes = briefPrefixesOf('a.b/');
    expect(briefBranchOf(odd, readings({ prefixes, texts: new Map([[odd, 'axb/a.b-x']]) }))).toBeNull();
    expect(briefBranchOf(odd, readings({ prefixes, texts: new Map([[odd, 'a.b/a.b-x']]) }))).toBe('a.b/a.b-x');
  });
});

describe('the rule agrees with briefPath', () => {
  // Every single-slash branch under a configured prefix, including the
  // <prefix>/<prefix>-<slug> shapes whose brief name looks misnamed.
  const branches = defaults.flatMap((p) => [
    `${p}/x`,
    `${p}/a-slug`,
    ...defaults.map((q) => `${p}/${q}-y`),
    `${p}/${p}-${p}-z`,
  ]);

  it.each(branches)('never refuses briefPath(%s) when the branch is known', (branch) => {
    const path = briefPath(branch);
    expect(briefNameRefusal(readings({ staged: [added(path)], branches: new Set([branch]) }))).toBeNull();
  });

  it.each(branches)('never refuses briefPath(%s) when the brief names its branch', (branch) => {
    const path = briefPath(branch);
    expect(briefNameRefusal(readings({ untracked: [path], texts: new Map([[path, `**Branch:** \`${branch}\``]]) }))).toBeNull();
  });

  it('refuses a looking-misnamed name that no evidence ties to a branch, and the computed path is briefPath of the flattened branch', () => {
    const misnamed = misnamedBriefs(readings({ staged: [added('.plot/briefs/feature-y.md')], branches: new Set(['feature/y']) }));
    expect(misnamed.map((m) => m.want)).toEqual([briefPath('feature/y')]);
  });
});

describe('briefNameRefusal', () => {
  it('allows when nothing is misnamed', () => {
    expect(briefNameRefusal(readings({ staged: [added('.plot/briefs/x.md')] }))).toBeNull();
  });

  it('names the path, the computed path, the git mv for a tracked file, and how to name the branch', () => {
    const text = briefNameRefusal(readings({ staged: [added('.plot/briefs/infra-x.md')] }));
    expect(text).toContain('  .plot/briefs/infra-x.md');
    expect(text).toContain('Rename it:  git mv .plot/briefs/infra-x.md .plot/briefs/x.md');
    expect(text).toContain('a branch whose last segment is infra-x, name that branch in the brief');
    expect(text).not.toContain('already exists');
  });

  it('offers a plain mv for an untracked file and warns when the target exists', () => {
    const text = briefNameRefusal(readings({ untracked: ['.plot/briefs/bug-y.md'], present: new Set(['.plot/briefs/y.md']) }));
    expect(text).toContain('Rename it:  mv .plot/briefs/bug-y.md .plot/briefs/y.md');
    expect(text).toContain('.plot/briefs/y.md already exists — compare the two before replacing it.');
  });
});
