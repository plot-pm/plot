import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, controllerGateOf, runGates, type ControllerReadings, type Where } from '../../src/server/entry/gate.js';
import { run as approve } from '../../src/server/entry/approve.js';
import { run as deliver } from '../../src/server/entry/deliver.js';

/**
 * The controller gate against injected readings: which git readings it takes,
 * what a failed reading answers, and the Bitbucket exception for an unpinned
 * `plot-host.sh pr-merge`.
 */

const GATED = ['bash skills/plot/scripts/plot-', 'deliver.sh s'].join('');

/** Readings that count the git reads and answer `where`, or throw it. */
const readings = (where: Where | Error, { desk = false, backend = 'github' } = {}) => {
  const reads = { where: 0, backend: 0 };
  const r: ControllerReadings = {
    desk: () => desk,
    where: async () => {
      reads.where += 1;
      if (where instanceof Error) throw where;
      return where;
    },
    backend: async () => {
      reads.backend += 1;
      return backend;
    },
  };
  return { r, reads };
};

const ask = async (r: ControllerReadings, command: string) => {
  const warned: string[] = [];
  const code = await runGates([controllerGateOf(r)], 'all', command, (l) => warned.push(l));
  return { code, warned: warned.join('\n') };
};

const MAIN: Where = { root: { ok: true, value: '/nowhere/repo' }, linked: false };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the controller gate reads no git before its text tests (LOW 9)', () => {
  it('allows an unattended call that names nothing outside a desk, with no git reading', async () => {
    vi.stubEnv('PLOT_UNATTENDED', '1');
    const { r, reads } = readings(new Error('git is broken'));
    expect(await ask(r, 'ls -la')).toEqual({ code: EXIT.allow, warned: '' });
    expect(reads.where).toBe(0);
  });

  it('allows an unattended call at a desk when the git reading throws', async () => {
    vi.stubEnv('PLOT_UNATTENDED', '1');
    const { r, reads } = readings(new Error('git is broken'), { desk: true });
    expect((await ask(r, 'ls -la')).code).toBe(EXIT.allow);
    expect(reads.where).toBe(1);
  });

  it('allows a call that names a merge word but runs no gated action when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    expect((await ask(r, 'git merge origin/main')).code).toBe(EXIT.allow);
  });

  it('refuses a gated action when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    const answer = await ask(r, GATED);
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('git is broken');
  });

  it('refuses an unpinned merge when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    expect((await ask(r, 'gh pr merge 12')).code).toBe(EXIT.refuse);
  });
});

describe('an unpinned plot-host.sh pr-merge on Bitbucket (M6)', () => {
  it('goes through where plot-host.sh resolves bitbucket, and says nothing pins there', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { r } = readings(MAIN, { backend: 'bitbucket' });
      const answer = await ask(r, 'bash skills/plot/scripts/plot-host.sh pr-merge 12');
      expect(answer.code).toBe(EXIT.allow);
      expect(answer.warned).toBe('');
      expect(write.mock.calls.join('')).toContain('cannot pin a merge to a commit');
    } finally {
      write.mockRestore();
    }
  });

  it('refuses on github, naming --match-head', async () => {
    const { r } = readings(MAIN);
    const answer = await ask(r, 'bash skills/plot/scripts/plot-host.sh pr-merge 12');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('add --match-head <sha>');
  });

  it('still refuses gh pr merge on bitbucket, naming --match-head-commit', async () => {
    const { r } = readings(MAIN, { backend: 'bitbucket' });
    const answer = await ask(r, 'gh pr merge 12');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('add --match-head-commit <sha>');
  });

  it('asks no backend for a pinned merge', async () => {
    const { r, reads } = readings(MAIN);
    expect((await ask(r, 'bash plot-host.sh pr-merge 12 --match-head abc')).code).toBe(EXIT.allow);
    expect(reads.backend).toBe(0);
  });
});

describe('a desk and no git', () => {
  it('allows a gated action in a linked worktree', async () => {
    const { r } = readings({ root: { ok: true, value: '/nowhere/desk' }, linked: true });
    expect((await ask(r, GATED)).code).toBe(EXIT.allow);
  });

  it('allows a gated action with no git, and says it went UNVERIFIED', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { r } = readings({ root: { ok: false }, linked: false });
      expect((await ask(r, GATED)).code).toBe(EXIT.allow);
      expect(write.mock.calls.join('')).toContain('UNVERIFIED');
    } finally {
      write.mockRestore();
    }
  });
});

describe('--who takes a name (H2, #1449)', () => {
  it.each([
    ['approve', approve, 'plot-approve'],
    ['deliver', deliver, 'plot-deliver'],
  ])('%s refuses a --who value that starts with -', async (_name, entry, prefix) => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-who-'));
    try {
      const warned: string[] = [];
      const code = await entry(['--who', '--dry-run', 'slug'], dir, dir, () => undefined, (s) => warned.push(s));
      expect(code).toBe(1);
      expect(warned.join('')).toBe(`${prefix}: --who takes a name, not the flag '--dry-run'\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
