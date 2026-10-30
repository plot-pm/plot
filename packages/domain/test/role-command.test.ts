import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROLE_NAMES, roleAgentsJson, roleCommand, type RoleAgentRef } from '../src/rules/role-command.js';

const ref = (over: Partial<RoleAgentRef> = {}): RoleAgentRef => ({
  name: 'fixer',
  agentsFile: '/tmp/r/agents.json',
  settingsFile: '/tmp/r/fixer.json',
  ...over,
});

describe('roleCommand', () => {
  it('emits --agent, --agents and --settings with user settings only', () => {
    const built = roleCommand(ref(), 80);
    expect(built).toEqual({
      read: 'command',
      command:
        "claude -p --setting-sources user --agent fixer --agents '/tmp/r/agents.json' --settings '/tmp/r/fixer.json' --max-turns 80",
    });
  });

  it('bounds the session with --max-turns, and omits it for no limit', () => {
    expect(roleCommand(ref(), 0)).toMatchObject({ read: 'command', command: expect.not.stringContaining('--max-turns') });
  });

  it('single-quotes a path holding a quote', () => {
    const built = roleCommand(ref({ agentsFile: "/tmp/a'b.json" }), 0);
    expect(built).toMatchObject({ command: expect.stringContaining(`'/tmp/a'\\''b.json'`) });
  });

  it('refuses a name that is not a declared role and a fractional turn limit', () => {
    expect(roleCommand(ref({ name: 'worker' as never }), 1).read).toBe('refused');
    expect(roleCommand(ref(), 1.5).read).toBe('refused');
  });
});

describe('roleAgentsJson', () => {
  it('translates the shipped definitions into one named agent each', () => {
    for (const name of ROLE_NAMES) {
      const text = readFileSync(join(__dirname, '../../../.claude/agents', `${name}.md`), 'utf8');
      const built = roleAgentsJson(name, text);
      if (built.read !== 'json') throw new Error(built.why);
      const agent = (JSON.parse(built.json) as Record<string, Record<string, unknown>>)[name]!;
      expect(Object.keys(JSON.parse(built.json))).toEqual([name]);
      expect(typeof agent.prompt).toBe('string');
      expect(agent.prompt).not.toBe('');
      expect(agent).not.toHaveProperty('isolation');
    }
  });

  it('carries scalars, numbers and lists, and replaces the frontmatter prompt path with the body', () => {
    const built = roleAgentsJson('fixer', '---\ndescription: d\nprompt: .plot/x.sh\nmodel: opus\nmaxTurns: 80\ntools:\n  - Read\n  - Bash\n---\nbody text\n');
    expect(built).toEqual({
      read: 'json',
      json: JSON.stringify({ fixer: { description: 'd', model: 'opus', maxTurns: 80, tools: ['Read', 'Bash'], prompt: 'body text' } }),
    });
  });

  it('skips unknown keys and non-key lines, unquotes scalars, and ignores a list item under no key', () => {
    const built = roleAgentsJson('fixer', '---\n# note\n  - orphan\nunknown: x\ndescription: "quoted"\nskills:\n  - a\n---\nbody');
    expect(built).toEqual({ read: 'json', json: JSON.stringify({ fixer: { description: 'quoted', skills: ['a'], prompt: 'body' } }) });
  });

  it('refuses a file with no frontmatter, no description or no body', () => {
    expect(roleAgentsJson('fixer', 'plain').read).toBe('refused');
    expect(roleAgentsJson('fixer', '---\nmodel: opus\n---\nbody').read).toBe('refused');
    expect(roleAgentsJson('fixer', '---\ndescription: d\n---\n').read).toBe('refused');
  });
});
