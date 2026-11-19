import { describe, expect, it } from 'vitest';

import type { FileChange } from '../src/ports/refs.js';
import { releaseHeadVerdict } from '../src/rules/release-head.js';

const change = (path: string, over: Partial<FileChange> = {}): FileChange => ({ path, status: 'modified', hunks: [], ...over });
const version = (path: string, from = '2.30.0', to = '2.31.0'): FileChange =>
  change(path, { hunks: [{ section: '', removed: [`  "version": "${from}",`], added: [`  "version": "${to}",`] }] });
const skillVersion: FileChange = change('skills/plot/SKILL.md', {
  hunks: [{ section: 'metadata:', removed: ['  version: 0.19.0'], added: ['  version: 0.20.0'] }],
});
/** The `plot` marketplace entry's version and release-tag ref, replaced in one hunk as the sync writes them. */
const marketplace = (ref = 'v2.31.0', to = '2.31.0'): FileChange =>
  change('.claude-plugin/marketplace.json', {
    hunks: [
      {
        section: '',
        removed: ['      "version": "2.30.0",', '        "ref": "v2.30.0"'],
        added: [`      "version": "${to}",`, `        "ref": "${ref}"`],
      },
    ],
  });
const versionStep: FileChange[] = [
  change('.changeset/a.md', { status: 'deleted' }),
  change('CHANGELOG.md', { hunks: [{ section: '', removed: [], added: ['## 2.31.0'] }] }),
  change('packages/board/CHANGELOG.md'),
  version('package.json'),
  version('packages/board/package.json'),
  version('.claude-plugin/plugin.json'),
  marketplace(),
  skillVersion,
];

describe('releaseHeadVerdict', () => {
  it('passes a head holding only the version step\'s changes', () => {
    expect(releaseHeadVerdict(versionStep)).toEqual({ read: 'clean' });
  });

  it('refuses a workflow file and names it', () => {
    const head = [...versionStep, change('.github/workflows/ci.yml', { hunks: [{ section: '', removed: ['a'], added: ['b'] }] })];
    expect(releaseHeadVerdict(head)).toEqual({ read: 'foreign', path: '.github/workflows/ci.yml' });
  });

  it('refuses a package.json whose dependency line changes beside the version line', () => {
    const swapped = change('package.json', {
      hunks: [
        { section: '', removed: ['  "version": "2.30.0",'], added: ['  "version": "2.31.0",'] },
        { section: '"dependencies": {', removed: ['    "left-pad": "1.3.0"'], added: ['    "left-pad": "9.9.9"'] },
      ],
    });
    expect(releaseHeadVerdict([swapped])).toEqual({ read: 'foreign', path: 'package.json' });
    const oneHunk = change('package.json', {
      hunks: [{ section: '', removed: ['  "version": "2.30.0",', '  "a": "1"'], added: ['  "version": "2.31.0",', '  "a": "2"'] }],
    });
    expect(releaseHeadVerdict([oneHunk])).toEqual({ read: 'foreign', path: 'package.json' });
  });

  it('passes a marketplace version and ref in separate hunks, as `git diff -U0` reads them', () => {
    const split = change('.claude-plugin/marketplace.json', {
      hunks: [
        { section: '', removed: ['      "version": "2.30.0",'], added: ['      "version": "2.31.0",'] },
        { section: '', removed: ['        "ref": "v2.30.0"'], added: ['        "ref": "v2.31.0"'] },
      ],
    });
    expect(releaseHeadVerdict([version('package.json'), split])).toEqual({ read: 'clean' });
  });

  it('passes a marketplace.json that replaces its version line alone', () => {
    expect(releaseHeadVerdict([version('.claude-plugin/marketplace.json')])).toEqual({ read: 'clean' });
  });

  it('refuses a marketplace ref that names anything but the tag of the version package.json writes', () => {
    const pkg = version('package.json');
    expect(releaseHeadVerdict([pkg, marketplace('v9.9.9')])).toEqual({ read: 'foreign', path: '.claude-plugin/marketplace.json' });
    expect(releaseHeadVerdict([pkg, marketplace('main')]).read).toBe('foreign');
    expect(releaseHeadVerdict([pkg, marketplace('2.31.0')]).read).toBe('foreign');
  });

  it('refuses a marketplace version and ref that agree with each other and not with package.json', () => {
    const downgrade = [version('package.json', '2.30.0', '2.31.0'), marketplace('v2.10.0', '2.10.0')];
    expect(releaseHeadVerdict(downgrade)).toEqual({ read: 'foreign', path: '.claude-plugin/marketplace.json' });
  });

  it('refuses a marketplace ref when package.json writes no version', () => {
    expect(releaseHeadVerdict([marketplace()])).toEqual({ read: 'foreign', path: '.claude-plugin/marketplace.json' });
  });

  it('refuses a marketplace line whose key or indentation changes', () => {
    const pkg = version('package.json');
    const keySwap = change('.claude-plugin/marketplace.json', {
      hunks: [{ section: '', removed: ['      "version": "2.30.0",'], added: ['      "ref": "v2.31.0",'] }],
    });
    expect(releaseHeadVerdict([pkg, keySwap]).read).toBe('foreign');
    const moved = change('.claude-plugin/marketplace.json', {
      hunks: [{ section: '', removed: ['        "ref": "v2.30.0"'], added: ['      "ref": "v2.31.0"'] }],
    });
    expect(releaseHeadVerdict([pkg, moved]).read).toBe('foreign');
  });

  it('refuses a ref line in any file but marketplace.json', () => {
    const pluginRef = change('.claude-plugin/plugin.json', {
      hunks: [{ section: '', removed: ['  "version": "2.30.0",', '  "ref": "v2.30.0"'], added: ['  "version": "2.31.0",', '  "ref": "v2.31.0"'] }],
    });
    expect(releaseHeadVerdict([pluginRef])).toEqual({ read: 'foreign', path: '.claude-plugin/plugin.json' });
  });

  it('refuses a marketplace url line changed beside the version and ref', () => {
    const urlSwap = change('.claude-plugin/marketplace.json', {
      hunks: [
        {
          section: '',
          removed: ['      "version": "2.30.0",', '        "url": "https://github.com/plot-pm/plot.git",', '        "ref": "v2.30.0"'],
          added: ['      "version": "2.31.0",', '        "url": "https://example.com/fork.git",', '        "ref": "v2.31.0"'],
        },
      ],
    });
    expect(releaseHeadVerdict([urlSwap]).read).toBe('foreign');
  });

  it('refuses a SKILL.md body line, and a version line outside the metadata block', () => {
    const body = change('skills/plot/SKILL.md', { hunks: [{ section: '## Steps', removed: ['old'], added: ['new'] }] });
    expect(releaseHeadVerdict([body])).toEqual({ read: 'foreign', path: 'skills/plot/SKILL.md' });
    const lookalike = change('skills/plot/SKILL.md', { hunks: [{ section: '## Steps', removed: ['  version: 1'], added: ['  version: 2'] }] });
    expect(releaseHeadVerdict([lookalike]).read).toBe('foreign');
  });

  it('refuses a changeset added, and the changeset config deleted', () => {
    expect(releaseHeadVerdict([change('.changeset/new.md', { status: 'added' })])).toEqual({ read: 'foreign', path: '.changeset/new.md' });
    expect(releaseHeadVerdict([change('.changeset/config.json', { status: 'deleted' })])).toEqual({ read: 'foreign', path: '.changeset/config.json' });
    expect(releaseHeadVerdict([change('.changeset/README.md', { status: 'deleted' })]).read).toBe('foreign');
  });

  it('refuses a mode or binary change to an allowed path', () => {
    expect(releaseHeadVerdict([change('CHANGELOG.md', { status: 'other' })]).read).toBe('foreign');
  });

  it('refuses a version line that is added with none removed', () => {
    const added = change('package.json', { hunks: [{ section: '', removed: [], added: ['  "version": "2.31.0",'] }] });
    expect(releaseHeadVerdict([added]).read).toBe('foreign');
  });

  it('refuses a manifest the version step would only edit: added, deleted, or modified without a hunk', () => {
    expect(releaseHeadVerdict([change('packages/new/package.json', { status: 'added' })])).toEqual({ read: 'foreign', path: 'packages/new/package.json' });
    expect(releaseHeadVerdict([change('.claude-plugin/plugin.json', { status: 'deleted' })]).read).toBe('foreign');
    expect(releaseHeadVerdict([change('package.json')])).toEqual({ read: 'foreign', path: 'package.json' });
  });

  it('reads an empty diff as no version step having run, never as clean', () => {
    expect(releaseHeadVerdict([])).toEqual({ read: 'empty' });
  });

  it('reads a failed diff as unaskable, never as clean', () => {
    expect(releaseHeadVerdict('unaskable')).toEqual({ read: 'unaskable' });
  });
});
