import { describe, expect, it } from 'vitest';
import { EXIT, mainCheckoutGateOf, runGates, type MainCheckoutReadings, type Where } from '../../src/server/entry/gate.js';

/** Readings that answer `where`, or throw it. */
const readings = (where: Where | Error): MainCheckoutReadings => ({
  where: async () => {
    if (where instanceof Error) throw where;
    return where;
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

describe('the main-checkout gate', () => {
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

  it('allows a read-only command in the main checkout, with no git reading at all', async () => {
    let reads = 0;
    const r: MainCheckoutReadings = { where: async () => { reads += 1; return MAIN; } };
    expect((await ask(r, 'git status')).code).toBe(EXIT.allow);
    expect(reads).toBe(0);
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

  it('refuses regardless of PLOT_UNATTENDED — an interactive session is in scope too', async () => {
    const prior = process.env.PLOT_UNATTENDED;
    delete process.env.PLOT_UNATTENDED;
    try {
      expect((await ask(readings(MAIN), 'git commit -m x')).code).toBe(EXIT.refuse);
    } finally {
      if (prior === undefined) delete process.env.PLOT_UNATTENDED;
      else process.env.PLOT_UNATTENDED = prior;
    }
  });
});
