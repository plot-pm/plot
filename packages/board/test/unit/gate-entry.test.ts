import { describe, expect, it } from 'vitest';
import { EXIT, GATES, NAME_ONLY_GATES, commandOf, pathOf, runGates, type Gate } from '../../src/server/entry/gate.js';

/**
 * The dispatch of `plot-gate.mjs`: which gates run for a command, how their
 * answers become one exit code, and that one gate's failure leaves another's
 * answer alone. The gates themselves are tested beside their rules.
 */

/** A gate with a fixed answer that records whether it was asked. */
const gate = (name: string, answer: string | null | Error, wants = true, onError: Gate['onError'] = 'allow') => {
  const asked: string[] = [];
  const g: Gate = {
    name,
    onError,
    wants: () => wants,
    ask: async (command) => {
      asked.push(command);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { g, asked };
};

const run = async (gates: Gate[], names: string[] | 'all', command = 'ls -la', path = '') => {
  const warned: string[] = [];
  const code = await runGates(gates, names, command, (l) => warned.push(l), path);
  return { code, warned };
};

describe('commandOf', () => {
  it('reads tool_input.command from the hook JSON', () => {
    expect(commandOf('{"tool_input":{"command":"git commit -m x"}}')).toBe('git commit -m x');
  });

  it.each(['', 'not json', '{}', '{"tool_input":{"command":7}}', 'null'])('answers the empty string for %j', (stdin) => {
    expect(commandOf(stdin)).toBe('');
  });
});

describe('pathOf', () => {
  it('reads tool_input.file_path from the hook JSON', () => {
    expect(pathOf('{"tool_input":{"file_path":".claude/agents/fixer.md"}}')).toBe('.claude/agents/fixer.md');
  });

  it('reads tool_input.path when file_path is absent', () => {
    expect(pathOf('{"tool_input":{"path":"scripts/check-x.sh"}}')).toBe('scripts/check-x.sh');
  });

  it.each(['', 'not json', '{}', '{"tool_input":{"file_path":7}}', 'null', '{"tool_input":{"command":"ls"}}'])(
    'answers the empty string for %j',
    (stdin) => {
      expect(pathOf(stdin)).toBe('');
    },
  );
});

describe('the gate table', () => {
  it('registers bundle-commit, brief-name, state, sprint-member, controller, phase, main-checkout, brief-push, and an empty command still allows', async () => {
    expect(GATES.map((g) => g.name)).toEqual([
      'bundle-commit',
      'brief-name',
      'state',
      'sprint-member',
      'controller',
      'phase',
      'main-checkout',
      'brief-push',
    ]);
    expect(await run([...GATES], 'all', '')).toEqual({ code: EXIT.allow, warned: [] });
  });

  it('keeps role-deny out of GATES — reachable only by name, never through --all', () => {
    expect(GATES.map((g) => g.name)).not.toContain('role-deny');
    expect(NAME_ONLY_GATES.map((g) => g.name)).toContain('role-deny');
  });

  it('does not let --all apply role-deny to a pinned merge the controller gate allows', async () => {
    const { code, warned } = await run([...GATES], 'all', 'gh pr merge 42 --match-head-commit deadbeef');
    expect(code).toBe(EXIT.allow);
    expect(warned).toEqual([]);
  });
});

describe('runGates', () => {
  it('refuses with exit 2 when a named gate refuses, printing its refusal', async () => {
    const { g } = gate('state', 'state: refused');
    expect(await run([g], ['state'])).toEqual({ code: EXIT.refuse, warned: ['state: refused'] });
  });

  it('allows when every named gate allows', async () => {
    const { g } = gate('state', null);
    expect(await run([g], ['state'])).toEqual({ code: EXIT.allow, warned: [] });
  });

  it('asks a gate only when it wants the command, and only named gates', async () => {
    const unwanted = gate('state', 'never', false);
    const unnamed = gate('phase', 'never');
    expect(await run([unwanted.g, unnamed.g], ['state'])).toEqual({ code: EXIT.allow, warned: [] });
    expect(unwanted.asked).toEqual([]);
    expect(unnamed.asked).toEqual([]);
  });

  it('prints every refusal and still exits 2', async () => {
    const a = gate('a', 'a refused');
    const b = gate('b', 'b refused');
    expect(await run([a.g, b.g], 'all')).toEqual({ code: EXIT.refuse, warned: ['a refused', 'b refused'] });
  });

  it('keeps one gate\'s exception from changing another gate\'s answer', async () => {
    const broken = gate('broken', new Error('boom'));
    const refusing = gate('refusing', 'refused');
    const { code, warned } = await run([broken.g, refusing.g], 'all');
    expect(code).toBe(EXIT.refuse);
    expect(warned[0]).toMatch(/broken gate failed \(boom\).*UNVERIFIED/);
    expect(warned[1]).toBe('refused');
  });

  it('allows when the only gate throws', async () => {
    const broken = gate('broken', new Error('boom'));
    expect((await run([broken.g], 'all')).code).toBe(EXIT.allow);
  });

  it('refuses with exit 2 and names the gate when a refuse-on-error gate throws', async () => {
    const broken = gate('controller', new Error('boom'), true, 'refuse');
    const { code, warned } = await run([broken.g], 'all');
    expect(code).toBe(EXIT.refuse);
    expect(warned).toEqual([expect.stringMatching(/controller gate failed \(boom\).*refuses/)]);
  });

  it('refuses when a refuse-on-error gate throws in wants', async () => {
    const g: Gate = { name: 'controller', onError: 'refuse', wants: () => { throw new Error('parse'); }, ask: async () => null };
    expect((await run([g], 'all')).code).toBe(EXIT.refuse);
  });

  it('allows with the UNVERIFIED warning when an allow-on-error gate throws', async () => {
    const broken = gate('state', new Error('boom'), true, 'allow');
    const { code, warned } = await run([broken.g], 'all');
    expect(code).toBe(EXIT.allow);
    expect(warned).toEqual([expect.stringMatching(/state gate failed \(boom\).*UNVERIFIED/)]);
  });

  it('names a gate it does not know and allows', async () => {
    const { code, warned } = await run([], ['ghost']);
    expect(code).toBe(EXIT.allow);
    expect(warned[0]).toMatch(/no gate named ghost/);
  });
});

describe('runGates — askPath', () => {
  /** A gate exposing `askPath` as well as the ordinary command-based `ask`. */
  const gateWithPath = (name: string, pathAnswer: string | null) => {
    const asked: string[] = [];
    const g: Gate & { askPath: (path: string) => Promise<string | null> } = {
      name,
      onError: 'allow',
      wants: () => false,
      ask: async () => null,
      askPath: async (path) => {
        asked.push(path);
        return pathAnswer;
      },
    };
    return { g, asked };
  };

  it('asks askPath when a path is given, even where wants(command) is false', async () => {
    const { g, asked } = gateWithPath('role-deny', 'path refused');
    const { code, warned } = await run([g], ['role-deny'], '', '.claude/agents/fixer.md');
    expect(code).toBe(EXIT.refuse);
    expect(warned).toEqual(['path refused']);
    expect(asked).toEqual(['.claude/agents/fixer.md']);
  });

  it('does not call askPath when no path is given', async () => {
    const { g, asked } = gateWithPath('role-deny', 'path refused');
    const { code } = await run([g], ['role-deny'], 'ls -la', '');
    expect(code).toBe(EXIT.allow);
    expect(asked).toEqual([]);
  });

  it('allows a path askPath does not refuse', async () => {
    const { g } = gateWithPath('role-deny', null);
    const { code, warned } = await run([g], ['role-deny'], '', 'packages/domain/src/index.ts');
    expect(code).toBe(EXIT.allow);
    expect(warned).toEqual([]);
  });

  it('ignores a path for a gate with no askPath', async () => {
    const { g } = gate('state', null);
    const { code } = await run([g], ['state'], '', '.claude/agents/fixer.md');
    expect(code).toBe(EXIT.allow);
  });
});
