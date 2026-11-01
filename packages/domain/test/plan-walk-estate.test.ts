import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { planStoreShell } from '../src/adapters/plan-store/plan-store-shell.js';
import { planStoreFixture, planRecord } from '../src/adapters/plan-store/plan-store-fixture.js';
import { refsFixture } from '../src/adapters/refs/refs-fixture.js';
import { shellContext } from '../src/adapters/scripts.js';
import { failed, isAnswered } from '../src/port-result.js';
import type { Refs, TreeBlob } from '../src/ports/refs.js';
import { estatePlans } from '../src/rules/plan-walk-estate.js';
import { readEstate, type EstateInput } from '../src/workflows/plan-walk-estate.js';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;

const planText = (branch: string): string =>
  ['# A plan', '', '## Status', '', '- **State:** Approved', '', '## Slices', '', '### Only slice', '', `- \`${branch}\` — the work`, ''].join('\n');

const INPUT: EstateInput = {
  mainBranch: 'main',
  planDir: 'docs/plans/',
  activeDir: 'docs/plans/active/',
  deliveredDir: 'docs/plans/delivered/',
  prefixes: ['feature', 'wip'],
};

const blob = (path: string, sha: string, mode = '100644'): TreeBlob => ({ mode, sha, path });

describe('estatePlans — which plan blobs the estate holds', () => {
  it('lists main first, then branch-only plans in ref order, each path once', () => {
    const estate = estatePlans({
      planDir: 'docs/plans/',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      main: [blob('docs/plans/a.md', 'a'), blob('docs/plans/active/a.md', 'l1', '120000'), blob('docs/plans/notes.txt', 'n')],
      links: new Map([['l1', '../a.md\n']]),
      branches: [
        { branch: 'feature/x', blobs: [blob('docs/plans/a.md', 'a2'), blob('docs/plans/b.md', 'b1'), blob('docs/plans/deep/c.md', 'c1')] },
        { branch: 'wip/y', blobs: [blob('docs/plans/b.md', 'b2'), blob('docs/plans/d.md', 'd1')] },
      ],
    });
    expect(estate.plans.map((p) => `${p.source}:${p.path}`)).toEqual([
      'main:docs/plans/a.md',
      'feature/x:docs/plans/b.md',
      'wip/y:docs/plans/d.md',
    ]);
    expect(estate.indexes).toEqual([{ index: 'active', path: 'docs/plans/active/a.md', target: '../a.md' }]);
  });

  it('follows a symlink directly under the plan directory to its target', () => {
    const estate = estatePlans({
      planDir: 'docs/plans/',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      main: [blob('docs/plans/real.md', 'r'), blob('docs/plans/link.md', 'l', '120000'), blob('docs/plans/gone.md', 'g', '120000')],
      links: new Map([['l', 'real.md'], ['g', 'missing.md']]),
      branches: [],
    });
    expect(estate.plans.map((p) => p.path)).toEqual(['docs/plans/real.md', 'docs/plans/real.md']);
    expect(estate.dangling).toEqual(['docs/plans/gone.md']);
  });
});

describe('estatePlans — link resolution forms', () => {
  it('resolves parent segments, absolute links and a bare plan directory', () => {
    const estate = estatePlans({
      planDir: 'docs/plans/',
      activeDir: 'docs/plans/active/',
      deliveredDir: 'docs/plans/delivered/',
      main: [
        blob('docs/plans/real.md', 'r'),
        blob('docs/plans/up.md', 'u', '120000'),
        blob('docs/plans/abs.md', 'x', '120000'),
        blob('docs/plans/delivered/real.md', 'd', '120000'),
      ],
      links: new Map([['u', './sub/../real.md'], ['x', '/elsewhere/real.md'], ['d', '../real.md']]),
      branches: [],
    });
    expect(estate.plans.map((p) => p.path)).toEqual(['docs/plans/real.md', 'docs/plans/real.md', 'docs/plans/real.md']);
    expect(estate.indexes).toEqual([{ index: 'delivered', path: 'docs/plans/delivered/real.md', target: '../real.md' }]);
  });

  it('reads a link with no recorded text as dangling and a root-level path as bare', () => {
    const estate = estatePlans({
      planDir: '',
      activeDir: 'active/',
      deliveredDir: 'delivered/',
      main: [blob('l.md', 'l', '120000'), blob('active/p.md', 'q', '120000')],
      links: new Map(),
      branches: [],
    });
    expect(estate.dangling).toEqual(['l.md']);
    expect(estate.indexes).toEqual([{ index: 'active', path: 'active/p.md', target: '' }]);
  });
});

describe('readEstate — one snapshot, parsed by object name', () => {
  const world = (over: Partial<Parameters<typeof refsFixture>[0]> = {}) =>
    refsFixture({
      shas: { 'origin/main': 'm1' },
      trees: {
        m1: [blob('docs/plans/a.md', 'sha-a')],
        t1: [blob('docs/plans/a.md', 'sha-a'), blob('docs/plans/b.md', 'sha-b')],
      },
      tips: { 'feature/x': 't1' },
      blobs: { 'sha-a': planText('feature/a'), 'sha-b': planText('wip/b') },
      ...over,
    });

  it('parses every plan with the configured prefixes', async () => {
    const refs = world();
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const estate = await readEstate(refs, store, INPUT);
    if (!isAnswered(estate)) throw new Error('readEstate should answer');
    expect(estate.value.mainSha).toBe('m1');
    expect(estate.value.plans.map((p) => [p.blob.source, p.record.file, p.record.branches])).toEqual([
      ['main', 'docs/plans/a.md', ['feature/a']],
      ['feature/x', 'docs/plans/b.md', ['wip/b']],
    ]);
  });

  it('lists commits and never the ref name, so a fetch mid-read changes nothing', async () => {
    const base = world();
    const listed: string[] = [];
    const spy: Refs = { ...base, listBlobs: (ref, dir) => (listed.push(ref), base.listBlobs(ref, dir)) };
    const estate = await readEstate(spy, planStoreRef(spy, shellContext(REPO_ROOT), 'origin/main', 'docs/plans'), INPUT);
    expect(estate.ok).toBe(true);
    expect(listed).toEqual(['m1', 't1']);
  });

  it('fails the beat when the default branch does not resolve and no checkout store is given', async () => {
    const refs = world({ shas: {} });
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(refs, store, INPUT)).ok).toBe(false);
  });

  it('reads the checkout\'s plan directory where the default branch does not resolve', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-estate-worktree-'));
    mkdirSync(join(root, 'docs/plans/active'), { recursive: true });
    writeFileSync(join(root, 'docs/plans/b.md'), planText('feature/b'));
    writeFileSync(join(root, 'docs/plans/a.md'), planText('feature/a'));
    writeFileSync(join(root, 'docs/plans/notes.txt'), 'not a plan\n');
    writeFileSync(join(root, 'docs/plans/active/a.md'), planText('feature/linked'));
    const refs = world({ shas: {} });
    const estate = await readEstate(refs, planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans'), INPUT,
      planStoreShell({ ...shellContext(REPO_ROOT), repoRoot: root }));
    if (!isAnswered(estate)) throw new Error('readEstate should answer');
    expect(estate.value).toMatchObject({ source: 'worktree', mainSha: '', indexes: [], dangling: [] });
    expect(estate.value.plans.map((p) => [p.blob.source, p.record.file, p.record.branches])).toEqual([
      ['main', 'docs/plans/a.md', ['feature/a']],
      ['main', 'docs/plans/b.md', ['feature/b']],
    ]);
  });

  it('reads a checkout with no plan directory as no plans, and fails where the directory cannot be listed', async () => {
    const refs = world({ shas: {} });
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    const empty = await readEstate(refs, store, INPUT, planStoreShell({ ...shellContext(REPO_ROOT), repoRoot: mkdtempSync(join(tmpdir(), 'plot-estate-noplans-')) }));
    expect(isAnswered(empty) && empty.value.plans).toEqual([]);
    const unlistable = { ...planStoreFixture(), listDir: async () => failed<readonly string[]>() };
    expect((await readEstate(refs, store, INPUT, unlistable)).ok).toBe(false);
  });

  it('reads origin/main and not the checkout where the default branch resolves', async () => {
    const refs = world();
    const listed: string[] = [];
    const checkout = { ...planStoreFixture(), listDir: async (dir: string) => (listed.push(dir), failed<readonly string[]>()) };
    const estate = await readEstate(refs, planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans'), INPUT, checkout);
    expect(isAnswered(estate) && estate.value.source).toBe('ref');
    expect(listed).toEqual([]);
  });

  it('fails the beat when a tree cannot be listed, never answering no plans', async () => {
    const refs: Refs = { ...world(), listBlobs: async () => failed<readonly TreeBlob[]>() };
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(refs, store, INPUT)).ok).toBe(false);
  });

  it('fails the beat when a plan blob cannot be read', async () => {
    const refs = world({ blobs: { 'sha-a': planText('feature/a') } });
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(refs, store, INPUT)).ok).toBe(false);
  });

  it('fails the beat when branch tips cannot be read', async () => {
    const refs: Refs = { ...world(), branchTips: async () => failed() };
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(refs, store, INPUT)).ok).toBe(false);
  });

  it('fails the beat when a branch tree cannot be listed', async () => {
    const base = world();
    const refs: Refs = {
      ...base,
      listBlobs: (ref, dir) => (ref === 't1' ? Promise.resolve(failed<readonly TreeBlob[]>()) : base.listBlobs(ref, dir)),
    };
    const store = planStoreRef(refs, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(refs, store, INPUT)).ok).toBe(false);
  });

  it('lists branches in bytewise order and skips main and HEAD', async () => {
    const base = world({ tips: { 'feature/z': 't1', 'feature/a': 't1', 'feature/m': 't1', main: 'm1', HEAD: 'm1' } });
    const listed: string[] = [];
    const spy: Refs = { ...base, listBlobs: (ref, dir) => (listed.push(ref), base.listBlobs(ref, dir)) };
    const store = planStoreRef(spy, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(spy, store, INPUT)).ok).toBe(true);
    expect(listed).toEqual(['m1', 't1', 't1', 't1']);
  });

  it('fails the beat when a symlink target cannot be read', async () => {
    const link = blob('docs/plans/active/a.md', 'l1', '120000');
    const unreadable = world({ trees: { m1: [blob('docs/plans/a.md', 'sha-a'), link] } });
    const store = planStoreRef(unreadable, shellContext(REPO_ROOT), 'origin/main', 'docs/plans');
    expect((await readEstate(unreadable, store, INPUT)).ok).toBe(false);
    const broken: Refs = { ...unreadable, readBlobs: async () => failed() };
    expect((await readEstate(broken, store, INPUT)).ok).toBe(false);
  });

  it('answers the failure of the plan store as the failure of the beat', async () => {
    const refs = world();
    const store = { ...planStoreFixture({ plans: [] }), readPlansAt: async () => failed() };
    expect((await readEstate(refs, store as never, INPUT)).ok).toBe(false);
  });

  it('accepts a store that returns records in blob order', async () => {
    const refs = world();
    const store = planStoreFixture({
      plans: [planRecord({ file: 'docs/plans/a.md' }), planRecord({ file: 'docs/plans/b.md' })],
    });
    const estate = await readEstate(refs, store, INPUT);
    expect(estate.ok).toBe(true);
  });
});

describe('planStoreRef — readPlans passes the repository’s configured prefixes', () => {
  it('reads Branch prefixes from the repository it parses in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plot-estate-config-'));
    writeFileSync(join(root, 'CLAUDE.md'), '# P\n\n## Plot Config\n\n- **Branch prefixes:** wip/, spike/\n');
    const refs = refsFixture({
      shas: { 'origin/main': 'm1' },
      trees: { 'origin/main': [blob('docs/plans/a.md', 'sha-a')] },
      blobs: { 'sha-a': planText('wip/a') },
    });
    const store = planStoreRef(refs, { ...shellContext(REPO_ROOT), repoRoot: root }, 'origin/main', 'docs/plans');
    const records = await store.readPlans(['docs/plans/a.md']);
    if (!isAnswered(records)) throw new Error('readPlans should answer');
    expect(records.value[0]!.branches).toEqual(['wip/a']);
  });
});
