import { describe, expect, it } from 'vitest';
import { EXIT, roleDenyGateOf, runGates } from '../../src/server/entry/gate.js';

/**
 * The `role-deny` gate a non-reviewer role's settings file wires: refuses the
 * forbidden calls `rules/role-gate.ts` names, and lets a permitted control
 * through in the same invocation — the shape the probe (wave 1) measured for
 * every forbidden call it tested.
 */

const gateOf = (defaultBranch: string, currentBranch: string, gatePath = '/var/plot/role-gate/plot-gate.mjs', treeRoot = '/w/fix') =>
  roleDenyGateOf({
    defaultBranch: async () => defaultBranch,
    currentBranch: async () => currentBranch,
    gatePath: () => gatePath,
    treeRoot: () => treeRoot,
  });

describe('the role-deny gate — command calls', () => {
  it.each([
    ['plot-host.sh commit-status abc123 success plot/review', 'writes the PR review status'],
    ['plot-review.mjs 42', 'runs the reviewer'],
    ['gh pr merge 42 --match-head-commit deadbeef', 'merges a pull request'],
    ['plot-ask.mjs merge 42 deadbeef', 'merges a pull request'],
    ['skills/plot/scripts/plot-host.sh pr-merge 42 --match-head deadbeef', 'merges a pull request'],
    ['gh api -X PUT repos/o/r/pulls/42/merge', 'merges a pull request'],
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
  it.each([
    '.claude/agents/fixer.md',
    'scripts/check-shell-lines.sh',
    'skills/plot/scripts/plot-controller-gate.sh',
    '.github/workflows/ci.yml',
    'skills/plot/scripts/board/plot-gate.mjs',
    'packages/domain/src/rules/role-gate.ts',
  ])(
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

describe('the role-deny gate — a gate inside the role\'s own tree', () => {
  const inside = () => gateOf('main', 'fix/the-slice', '/w/fix/skills/plot/scripts/board/plot-gate.mjs', '/w/fix');

  it('refuses a permitted command', async () => {
    const warned: string[] = [];
    const code = await runGates([inside()], ['role-deny'], 'echo permitted-control-ran', (l) => warned.push(l));
    expect(code).toBe(EXIT.refuse);
    expect(warned[0]).toContain('PLOT_ROLE_GATE');
  });

  it('refuses a write to an ordinary path', async () => {
    const warned: string[] = [];
    const code = await runGates([inside()], ['role-deny'], '', (l) => warned.push(l), 'packages/domain/src/index.ts');
    expect(code).toBe(EXIT.refuse);
    expect(warned[0]).toContain('/w/fix/skills/plot/scripts/board/plot-gate.mjs');
  });

  it('allows the same calls from a gate outside the tree', async () => {
    const outside = gateOf('main', 'fix/the-slice');
    expect(await runGates([outside], ['role-deny'], 'echo permitted-control-ran', () => {})).toBe(EXIT.allow);
    expect(await runGates([outside], ['role-deny'], '', () => {}, 'packages/domain/src/index.ts')).toBe(EXIT.allow);
  });
});
