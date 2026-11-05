import { describe, expect, it } from 'vitest';

import type { FileChange } from '../src/ports/refs.js';
import { releaseHeadVerdict } from '../src/rules/release-head.js';

const change = (path: string, over: Partial<FileChange> = {}): FileChange => ({ path, status: 'modified', hunks: [], ...over });
const version = (path: string, from = '2.30.0', to = '2.31.0'): FileChange =>
  change(path, { hunks: [{ section: '', removed: [`  "version": "${from}",`], added: [`  "version": "${to}",`] }] });
const skillVersion: FileChange = change('skills/plot/SKILL.md', {
  hunks: [{ section: 'metadata:', removed: ['  version: 0.19.0'], added: ['  version: 0.20.0'] }],
});
const versionStep: FileChange[] = [
  change('.changeset/a.md', { status: 'deleted' }),
  change('CHANGELOG.md', { hunks: [{ section: '', removed: [], added: ['## 2.31.0'] }] }),
  change('packages/board/CHANGELOG.md'),
  version('package.json'),
  version('packages/board/package.json'),
  version('.claude-plugin/plugin.json'),
  version('.claude-plugin/marketplace.json'),
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

  it('reads an empty diff as no version step having run, never as clean', () => {
    expect(releaseHeadVerdict([])).toEqual({ read: 'empty' });
  });

  it('reads a failed diff as unaskable, never as clean', () => {
    expect(releaseHeadVerdict('unaskable')).toEqual({ read: 'unaskable' });
  });
});
