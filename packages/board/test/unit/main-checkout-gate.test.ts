import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { EXIT, mainCheckoutGateOf, runGates, type MainCheckoutReadings, type Where } from '../../src/server/entry/gate.js';

/** Readings that answer `where`, or throw it, and record each directory asked. */
const readings = (where: Where | Error | ((dir: string) => Where), asked: string[] = []): MainCheckoutReadings => ({
  where: async (dir) => {
    asked.push(dir);
    if (where instanceof Error) throw where;
    return typeof where === 'function' ? where(dir) : where;
  },
});

const ask = async (r: MainCheckoutReadings, command: string) => {
  const warned: string[] = [];
  const code = await runGates([mainCheckoutGateOf(r)], 'all', command, (l) => warned.push(l));
  return { code, warned: warned.join('\n') };
};

const MAIN: Where = { root: { ok: true, value: '/nowhere/repo' }, linked: false };
const DESK: Where = { root: { ok: true, value: '/nowhere/desk' }, linked: true };
const NO_ROOT: Where = { root: { ok: false }, linked: false };

let prior: string | undefined;
beforeEach(() => {
  prior = process.env.PLOT_UNATTENDED;
});
afterEach(() => {
  if (prior === undefined) delete process.env.PLOT_UNATTENDED;
  else process.env.PLOT_UNATTENDED = prior;
});

describe('the main-checkout gate, for an unattended agent', () => {
  beforeEach(() => {
    process.env.PLOT_UNATTENDED = '1';
  });

  it('refuses a commit in the main checkout', async () => {
    const answer = await ask(readings(MAIN), 'git commit -m x');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('MAIN checkout');
  });

  it('refuses a reset in the main checkout', async () => {
    expect((await ask(readings(MAIN), 'git reset --hard HEAD~1')).code).toBe(EXIT.refuse);
  });

  it('allows the same command at a desk (a linked worktree)', async () => {
    expect((await ask(readings(DESK), 'git commit -m x')).code).toBe(EXIT.allow);
  });

  it('judges the directory -C names rather than the working directory', async () => {
    const asked: string[] = [];
    const r = readings((dir) => (dir === '/nowhere/repo' ? MAIN : DESK), asked);
    expect((await ask(r, 'git -C /nowhere/repo commit -m x')).code).toBe(EXIT.refuse);
    expect(asked).toEqual(['/nowhere/repo']);
    expect((await ask(r, 'git -C /nowhere/desk commit -m x')).code).toBe(EXIT.allow);
  });

  it('resolves a relative -C path against the working directory', async () => {
    const asked: string[] = [];
    await ask(readings(DESK, asked), 'git -C sub commit -m x');
    expect(asked).toEqual([resolve(process.cwd(), 'sub')]);
  });

  it('refuses when any one of several calls writes to the main checkout', async () => {
    const r = readings((dir) => (dir === '/nowhere/repo' ? MAIN : DESK));
    expect((await ask(r, 'git -C /nowhere/desk commit -m x && git -C /nowhere/repo reset --hard')).code).toBe(EXIT.refuse);
  });

  it('allows a read-only command in the main checkout, with no git reading at all', async () => {
    const asked: string[] = [];
    expect((await ask(readings(MAIN, asked), 'git status && git branch --show-current')).code).toBe(EXIT.allow);
    expect(asked).toEqual([]);
  });

  it('allows a mutating command when the repository root cannot be read', async () => {
    expect((await ask(readings(NO_ROOT), 'git commit -m x')).code).toBe(EXIT.allow);
  });

  it('allows and goes UNVERIFIED when the git reading throws', async () => {
    const answer = await ask(readings(new Error('git is broken')), 'git commit -m x');
    expect(answer.code).toBe(EXIT.allow);
    expect(answer.warned).toContain('UNVERIFIED');
    expect(answer.warned).toContain('main-checkout');
  });
});

describe('the main-checkout gate, for an attended session', () => {
  it.each([undefined, '0', ''])('allows a commit in the main checkout with PLOT_UNATTENDED=%s, reading no git', async (value) => {
    if (value === undefined) delete process.env.PLOT_UNATTENDED;
    else process.env.PLOT_UNATTENDED = value;
    const asked: string[] = [];
    expect((await ask(readings(MAIN, asked), 'git commit -m x')).code).toBe(EXIT.allow);
    expect(asked).toEqual([]);
  });
});
