import { describe, expect, it } from 'vitest';
import { EXIT, roleDenyGateOf, runGates } from '../../src/server/entry/gate.js';

/**
 * The `role-deny` gate a non-reviewer role's settings file wires: refuses the
 * forbidden calls `rules/role-gate.ts` names, and lets a permitted control
 * through in the same invocation — the shape the probe (wave 1) measured for
 * every forbidden call it tested.
 */

const gateOf = (defaultBranch: string, currentBranch: string) =>
  roleDenyGateOf({ defaultBranch: async () => defaultBranch, currentBranch: async () => currentBranch });

describe('the role-deny gate — command calls', () => {
  it.each([
    ['plot-host.sh commit-status abc123 success plot/review', 'writes the PR review status'],
    ['plot-review.mjs 42', 'runs the reviewer'],
    ['gh pr merge 42 --match-head-commit deadbeef', 'merges a pull request'],
    ['plot-ask.mjs merge 42 deadbeef', 'merges a pull request'],
    ['git push origin main', 'pushes the default branch'],
    ['git commit -m "Fixes #123"', 'closes an issue'],
  ])('refuses %s', async (command, fragment) => {
    const gate = gateOf('main', 'fix/the-slice');
    const warned: string[] = [];
    const code = await runGates([gate], ['role-deny'], command, (l) => warned.push(l));
    expect(code).toBe(EXIT.refuse);
    expect(warned[0]).toContain(fragment);
  });

  it('allows a permitted control in the same session', async () => {
    const gate = gateOf('main', 'fix/the-slice');
    const warned: string[] = [];
    const forbidden = await runGates([gate], ['role-deny'], 'gh pr merge 42', (l) => warned.push(l));
    expect(forbidden).toBe(EXIT.refuse);

    const control = await runGates([gate], ['role-deny'], 'git commit -m "a normal change"', () => {});
    expect(control).toBe(EXIT.allow);
  });
});

describe('the role-deny gate — protected paths', () => {
  it.each(['.claude/agents/fixer.md', 'scripts/check-shell-lines.sh', 'skills/plot/scripts/plot-controller-gate.sh', '.github/workflows/ci.yml'])(
    'refuses a write to %s',
    async (path) => {
      const gate = gateOf('main', 'fix/the-slice');
      const warned: string[] = [];
      const code = await runGates([gate], ['role-deny'], '', (l) => warned.push(l), path);
      expect(code).toBe(EXIT.refuse);
      expect(warned[0]).toContain(path);
    },
  );

  it('allows a write to an ordinary path, and a forbidden command still refuses in the same gate', async () => {
    const gate = gateOf('main', 'fix/the-slice');
    const allowed = await runGates([gate], ['role-deny'], '', () => {}, 'packages/domain/src/index.ts');
    expect(allowed).toBe(EXIT.allow);

    const warned: string[] = [];
    const refused = await runGates([gate], ['role-deny'], 'gh pr merge 42', (l) => warned.push(l), 'packages/domain/src/index.ts');
    expect(refused).toBe(EXIT.refuse);
    expect(warned).toEqual([expect.stringContaining('merges a pull request')]);
  });
});
