import { describe, expect, it } from 'vitest';

import {
  branchTipsOf,
  checkoutBranchOf,
  currentBranchOf,
  defaultBranchOf,
  isRefName,
  listBranchesOf,
  looseRefOf,
  matchingRefs,
  oidOf,
  packedRefsOf,
  refMatches,
  refsFrom,
  refStateOf,
  repoConfigOf,
  resolveName,
  shortRefName,
  symbolicTarget,
  worktreesFrom,
  type RefTable,
  type RefValue,
} from '../src/rules/ref-files.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

const table = (entries: Record<string, RefValue>): RefTable => new Map(Object.entries(entries));

const PACKED = [
  '# pack-refs with: peeled fully-peeled sorted ',
  `${A} refs/heads/main`,
  `${B} refs/remotes/origin/main`,
  `${C} refs/tags/v1.0`,
  `^${D}`,
  '',
].join('\n');

describe('packedRefsOf', () => {
  it('reads the header, ref lines and a peel line that belongs to the tag above it', () => {
    const packed = packedRefsOf(PACKED);
    expect(packed).toEqual(
      new Map<string, RefValue>([
        ['refs/heads/main', { oid: A }],
        ['refs/remotes/origin/main', { oid: B }],
        ['refs/tags/v1.0', { oid: C, peeled: D }],
      ]),
    );
  });

  it('fails the parse on a ^ line first in the file', () => {
    expect(packedRefsOf(`# pack-refs with: peeled\n^${D}\n${A} refs/heads/main\n`)).toBeUndefined();
  });

  it('fails the parse on a malformed line, a bad oid and a bad peel', () => {
    expect(packedRefsOf('garbage\n')).toBeUndefined();
    expect(packedRefsOf(`zz refs/heads/main\n`)).toBeUndefined();
    expect(packedRefsOf(`${A} refs/heads/a..b\n`)).toBeUndefined();
    expect(packedRefsOf(`${A} refs/tags/v\n^nope\n`)).toBeUndefined();
  });

  it('reads an empty file as no refs', () => {
    expect(packedRefsOf('')).toEqual(new Map());
  });
});

describe('looseRefOf and symbolicTarget', () => {
  it('reads an oid, a symbolic ref and refuses anything else', () => {
    expect(looseRefOf(`${A}\n`)).toEqual({ oid: A });
    expect(looseRefOf('ref: refs/heads/main\n')).toEqual({ symbolic: 'refs/heads/main' });
    expect(looseRefOf('not a ref\n')).toBeUndefined();
    expect(symbolicTarget(`${A}\n`)).toBeUndefined();
    expect(symbolicTarget('ref: refs/remotes/origin/main')).toBe('refs/remotes/origin/main');
  });
});

describe('isRefName', () => {
  it('accepts plain names and refuses what check-ref-format refuses', () => {
    expect(isRefName('refs/heads/feature/x')).toBe(true);
    for (const bad of ['', '@', 'a/', 'a.', 'a..b', 'a@{1}', 'a//b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'refs/.hidden', 'refs/x.lock']) {
      expect(isRefName(bad), bad).toBe(false);
    }
  });
});

describe('refsFrom', () => {
  it('lets a loose ref shadow the packed ref of the same name', () => {
    const refs = refsFrom({
      loose: table({ 'refs/heads/main': { oid: B } }),
      packed: table({ 'refs/heads/main': { oid: A }, 'refs/heads/other': { oid: C } }),
    });
    expect(refs.get('refs/heads/main')).toEqual({ oid: B });
    expect(refs.get('refs/heads/other')).toEqual({ oid: C });
  });

  it('keeps tags out of refState and answers resolve for a packed tag with the tag object', () => {
    const refs = refsFrom({
      loose: table({ HEAD: { symbolic: 'refs/heads/main' } }),
      packed: packedRefsOf(PACKED) as RefTable,
    });
    const state = refStateOf(refs, 'both') ?? [];
    expect(state.some((each) => each.ref.startsWith('refs/tags/'))).toBe(false);
    expect(state).toEqual([
      { ref: 'refs/heads/main', sha: A, head: true },
      { ref: 'refs/remotes/origin/main', sha: B },
    ]);
    expect(resolveName('v1.0', refs)).toBe(C);
  });
});

describe('oidOf', () => {
  it('follows one symbolic level and refuses a chain or a dangling target', () => {
    const refs = table({
      'refs/heads/main': { oid: A },
      HEAD: { symbolic: 'refs/heads/main' },
      'refs/x/chain': { symbolic: 'HEAD' },
      'refs/x/dangling': { symbolic: 'refs/heads/gone' },
    });
    expect(oidOf('HEAD', refs)).toBe(A);
    expect(oidOf('refs/x/chain', refs)).toBeUndefined();
    expect(oidOf('refs/x/dangling', refs)).toBeUndefined();
    expect(oidOf('refs/heads/none', refs)).toBeNull();
  });
});

describe('resolveName', () => {
  const refs = table({
    HEAD: { symbolic: 'refs/heads/main' },
    'refs/heads/main': { oid: A },
    'refs/heads/topic': { oid: B },
    'refs/tags/topic': { oid: C },
    'refs/remotes/origin/main': { oid: B },
    'refs/remotes/origin/HEAD': { symbolic: 'refs/remotes/origin/main' },
  });

  it.each(['main^', 'HEAD~1', 'main:docs', '@{u}', 'a..b', 'abcdef1', 'ORIG_HEAD', '-n', 'main-worktree/HEAD', 'worktrees/x/HEAD', '@'])(
    'answers undefined for %s, which git answers',
    (name) => {
      expect(resolveName(name, refs)).toBeUndefined();
    },
  );

  it('follows git short-name order', () => {
    expect(resolveName('HEAD', refs)).toBe(A);
    expect(resolveName('main', refs)).toBe(A);
    expect(resolveName('refs/heads/main', refs)).toBe(A);
    expect(resolveName('topic', refs)).toBe(C);
    expect(resolveName('heads/topic', refs)).toBe(B);
    expect(resolveName('origin/main', refs)).toBe(B);
    expect(resolveName('origin', refs)).toBe(B);
  });

  it('answers null for a plain name no rule finds', () => {
    expect(resolveName('nothing', refs)).toBeNull();
  });
});

describe('shortRefName', () => {
  const refs = table({
    'refs/heads/main': { oid: A },
    'refs/heads/origin/main': { oid: A },
    'refs/remotes/origin/main': { oid: B },
    'refs/remotes/origin/HEAD': { symbolic: 'refs/remotes/origin/main' },
    'refs/tags/both': { oid: C },
    'refs/heads/both': { oid: C },
  });

  it('shortens to the unambiguous name', () => {
    expect(shortRefName('refs/heads/main', refs, true)).toBe('main');
    expect(shortRefName('refs/remotes/origin/HEAD', refs, true)).toBe('origin');
    expect(shortRefName('refs/remotes/origin/main', refs, true)).toBe('remotes/origin/main');
    expect(shortRefName('refs/remotes/origin/main', refs, false)).toBe('remotes/origin/main');
  });

  it('checks only the earlier rules when not strict', () => {
    expect(shortRefName('refs/tags/both', refs, false)).toBe('both');
    expect(shortRefName('refs/tags/both', refs, true)).toBe('tags/both');
    expect(shortRefName('refs/heads/both', refs, true)).toBe('heads/both');
  });

  it('keeps a name no rule shortens', () => {
    expect(shortRefName('HEAD', refs, true)).toBe('HEAD');
  });
});

describe('refMatches', () => {
  it('matches a prefix at a slash and a glob within one level', () => {
    expect(refMatches('refs/remotes/origin/main', 'refs/remotes/origin')).toBe(true);
    expect(refMatches('refs/remotes/origin/main', 'refs/remotes/origin/')).toBe(true);
    expect(refMatches('refs/remotes/originx/main', 'refs/remotes/origin')).toBe(false);
    expect(refMatches('refs/remotes/origin', 'refs/remotes/origin')).toBe(true);
    expect(refMatches('refs/remotes/origin/idea/x', 'refs/remotes/origin/idea/*')).toBe(true);
    expect(refMatches('refs/remotes/origin/idea/x/y', 'refs/remotes/origin/idea/*')).toBe(false);
    expect(refMatches('refs/remotes/origin/feature-x', 'refs/remotes/origin/feature?x')).toBe(true);
    expect(refMatches('refs/remotes/origin/feature.x', 'refs/remotes/origin/feature+x')).toBe(false);
  });

  it('answers undefined for a pattern it does not cover', () => {
    expect(refMatches('refs/heads/a', 'refs/heads/[ab]')).toBeUndefined();
    expect(refMatches('refs/heads/a', 'refs/**')).toBeUndefined();
  });
});

describe('matchingRefs and its readers', () => {
  const refs = table({
    HEAD: { symbolic: 'refs/heads/main' },
    'refs/heads/main': { oid: A },
    'refs/heads/feature/x': { oid: B },
    'refs/remotes/origin/main': { oid: B },
    'refs/remotes/origin/HEAD': { symbolic: 'refs/remotes/origin/main' },
    'refs/remotes/origin/idea/y': { oid: C },
    'refs/remotes/fork/main': { oid: D },
    'refs/tags/v1': { oid: C },
  });

  it('sorts by name and resolves a symbolic ref', () => {
    expect(matchingRefs(refs, ['refs/remotes/origin'])).toEqual([
      { ref: 'refs/remotes/origin/HEAD', oid: B },
      { ref: 'refs/remotes/origin/idea/y', oid: C },
      { ref: 'refs/remotes/origin/main', oid: B },
    ]);
  });

  it('answers undefined for an uncovered pattern and for a dangling match', () => {
    expect(matchingRefs(refs, ['refs/[a]'])).toBeUndefined();
    const dangling = new Map(refs).set('refs/heads/gone', { symbolic: 'refs/heads/none' });
    expect(matchingRefs(dangling, ['refs/heads'])).toBeUndefined();
  });

  it('reads refState per scope', () => {
    expect(refStateOf(refs, 'local')).toEqual([
      { ref: 'refs/heads/feature/x', sha: B },
      { ref: 'refs/heads/main', sha: A, head: true },
    ]);
    expect(refStateOf(refs, 'remote')?.map((each) => each.ref)).toEqual([
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/idea/y',
      'refs/remotes/origin/main',
    ]);
    expect(refStateOf(refs, 'both')?.map((each) => each.ref)).toContain('refs/remotes/fork/main');
    const detached = new Map(refs).set('HEAD', { oid: A });
    expect(refStateOf(detached, 'local')?.some((each) => each.head)).toBe(false);
    expect(refStateOf(new Map([...refs].filter(([name]) => name !== 'HEAD')), 'local')?.some((each) => each.head)).toBe(false);
  });

  it('lists branches without their namespace and without HEAD', () => {
    expect(listBranchesOf(refs, false)).toEqual(['feature/x', 'main']);
    expect(listBranchesOf(refs, true)).toEqual(['idea/y', 'main']);
  });

  it('reads branch tips with origin/ removed', () => {
    expect(branchTipsOf(refs, ['refs/remotes/origin/idea/*', 'refs/heads/'])).toEqual([
      { branch: 'feature/x', sha: B },
      { branch: 'main', sha: A },
      { branch: 'idea/y', sha: C },
    ]);
    expect(branchTipsOf(refs, ['refs/[x]'])).toBeUndefined();
  });
});

describe('defaultBranchOf', () => {
  it('reads origin/HEAD and removes origin/', () => {
    expect(
      defaultBranchOf(table({ 'refs/remotes/origin/HEAD': { symbolic: 'refs/remotes/origin/main' }, 'refs/remotes/origin/main': { oid: A } })),
    ).toBe('main');
  });

  it('answers undefined for an absent, detached or dangling origin/HEAD', () => {
    expect(defaultBranchOf(table({}))).toBeUndefined();
    expect(defaultBranchOf(table({ 'refs/remotes/origin/HEAD': { oid: A } }))).toBeUndefined();
    expect(defaultBranchOf(table({ 'refs/remotes/origin/HEAD': { symbolic: 'refs/remotes/origin/gone' } }))).toBeUndefined();
  });
});

describe('currentBranchOf', () => {
  it('answers the short branch, HEAD when detached, and undefined for an unborn branch or no HEAD', () => {
    expect(currentBranchOf(table({ HEAD: { symbolic: 'refs/heads/main' }, 'refs/heads/main': { oid: A } }))).toBe('main');
    expect(currentBranchOf(table({ HEAD: { oid: A } }))).toBe('HEAD');
    expect(currentBranchOf(table({ HEAD: { symbolic: 'refs/heads/unborn' } }))).toBeUndefined();
    expect(currentBranchOf(table({}))).toBeUndefined();
  });
});

describe('checkoutBranchOf', () => {
  it('answers the branch unshortened, an unborn branch, and the empty name when detached', () => {
    const main = { HEAD: { symbolic: 'refs/heads/main' }, 'refs/heads/main': { oid: A } };
    expect(checkoutBranchOf(table(main))).toBe('main');
    expect(checkoutBranchOf(table({ ...main, 'refs/tags/main': { oid: A }, 'refs/remotes/main/HEAD': { oid: A } }))).toBe('main');
    expect(checkoutBranchOf(table({ HEAD: { symbolic: 'refs/heads/unborn' } }))).toBe('unborn');
    expect(checkoutBranchOf(table({ HEAD: { oid: A } }))).toBe('');
  });

  it('answers undefined for no HEAD and for a target outside refs/heads/', () => {
    expect(checkoutBranchOf(table({}))).toBeUndefined();
    expect(checkoutBranchOf(table({ HEAD: { symbolic: 'refs/remotes/origin/main' }, 'refs/remotes/origin/main': { oid: A } }))).toBeUndefined();
  });
});

describe('repoConfigOf', () => {
  it('reads refStorage and bare with git defaults', () => {
    expect(repoConfigOf('[core]\n\tbare = false\n')).toEqual({ refStorage: 'files', bare: false });
    expect(repoConfigOf('[core]\n\tbare\n[extensions]\n\trefStorage = "reftable" ; note\n')).toEqual({ refStorage: 'reftable', bare: true });
    expect(repoConfigOf('[Extensions]\nREFSTORAGE=Files\n[core]\nbare = yes\n')).toEqual({ refStorage: 'files', bare: true });
    expect(repoConfigOf('[remote "origin"]\n\tbare = true\n\tnot an entry!\n[core]\nbare = off\n')).toEqual({ refStorage: 'files', bare: false });
    expect(repoConfigOf('[extensions]\nrefstorage =\n')).toEqual({ refStorage: '', bare: false });
    expect(repoConfigOf('[extensions]\nrefstorage\n')).toEqual({ refStorage: '', bare: false });
  });
});

describe('worktreesFrom', () => {
  it('puts the main checkout first and reads each linked worktree', () => {
    const trees = worktreesFrom({
      main: { path: '/repo', head: 'ref: refs/heads/main\n' },
      linked: [
        { gitdir: '/wt/a/.git', head: 'ref: refs/heads/feature/a\n', locked: false, present: true },
        { gitdir: '/wt/b/.git', head: `${A}\n`, locked: false, present: true },
        { gitdir: '/wt/gone/.git', head: 'ref: refs/heads/gone\n', locked: false, present: false },
        { gitdir: '/wt/held/.git', head: 'ref: refs/heads/held\n', locked: true, present: false },
        { gitdir: undefined, head: 'ref: refs/heads/none\n', locked: false, present: false },
      ],
    });
    expect(trees?.[0]).toEqual({ path: '/repo', branch: 'main', detached: false, isMain: true, clean: false, agentSession: null, prunable: false });
    expect(trees?.slice(1).map((t) => [t.path, t.branch, t.detached, t.isMain, t.prunable])).toEqual([
      ['/wt/a', 'feature/a', false, false, false],
      ['/wt/b', '', true, false, false],
      ['/wt/gone', 'gone', false, false, true],
      ['/wt/held', 'held', false, false, false],
    ]);
  });

  it('answers undefined where a HEAD cannot be read', () => {
    expect(worktreesFrom({ main: { path: '/repo', head: undefined }, linked: [] })).toBeUndefined();
    expect(
      worktreesFrom({ main: { path: '/repo', head: `${A}\n` }, linked: [{ gitdir: '/wt/x/.git', head: 'junk', locked: false, present: true }] }),
    ).toBeUndefined();
  });
});
