import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  composeRoleFiles,
  roleDefinitionPath,
  roleFilePaths,
  roleSettingsPath,
} from '../src/rules/adoption-roles.js';
import { ROLE_NAMES } from '../src/rules/role-command.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** This repository's own copies of every role file it carries. */
const ownCopies = (): Record<string, string> =>
  Object.fromEntries(
    roleFilePaths()
      .filter((p) => existsSync(join(repoRoot, p)))
      .map((p) => [p, readFileSync(join(repoRoot, p), 'utf8')]),
  );

const shipped = { '.claude/agents/a.md': 'A', '.claude/settings/a.json': 'S' };

describe('roleFilePaths', () => {
  it('derives every path from ROLE_NAMES', () => {
    expect(roleFilePaths()).toEqual(
      ROLE_NAMES.flatMap((r) => [roleDefinitionPath(r), roleSettingsPath(r)]),
    );
    expect(roleFilePaths()).toHaveLength(ROLE_NAMES.length * 2);
  });
});

describe('composeRoleFiles', () => {
  const all = (content: string): Record<string, string> =>
    Object.fromEntries(roleFilePaths().map((p) => [p, content]));

  it('writes every shipped file into an empty repository', () => {
    const d = composeRoleFiles(ownCopies(), {});
    expect(d.write.map((w) => w.path).sort()).toEqual(Object.keys(ownCopies()).sort());
    expect(d.stale).toEqual([]);
    expect(d.unchanged).toEqual([]);
  });

  it('writes an absent file, keeps an identical one and reports a differing one stale', () => {
    const s = all('shipped');
    const d = composeRoleFiles(s, {
      '.claude/agents/reviewer.md': 'shipped',
      '.claude/agents/fixer.md': 'customised',
    });
    expect(d.unchanged).toEqual(['.claude/agents/reviewer.md']);
    expect(d.stale).toEqual(['.claude/agents/fixer.md']);
    expect(d.write.map((w) => w.path)).not.toContain('.claude/agents/fixer.md');
    expect(d.write.map((w) => w.path)).not.toContain('.claude/agents/reviewer.md');
    expect(d.write).toHaveLength(roleFilePaths().length - 2);
    expect(d.gaps).toEqual(['.claude/agents/fixer.md differs from the shipped copy (stale) — left as it is']);
  });

  it('treats a null reading as absent', () => {
    const d = composeRoleFiles(all('x'), { '.claude/agents/fixer.md': null });
    expect(d.write.map((w) => w.path)).toContain('.claude/agents/fixer.md');
  });

  it('writes nothing and reports nothing on a second run', () => {
    const s = ownCopies();
    const first = composeRoleFiles(s, {});
    const after = { ...Object.fromEntries(first.write.map((w) => [w.path, w.content])) };
    const second = composeRoleFiles(s, after);
    expect(second.write).toEqual([]);
    expect(second.stale).toEqual([]);
    expect(second.gaps).toEqual([]);
    expect([...second.unchanged].sort()).toEqual(Object.keys(s).sort());
  });

  it('skips a settings path with no shipped copy but reports a missing definition', () => {
    const d = composeRoleFiles({ '.claude/agents/fixer.md': 'F' }, {});
    expect(d.write).toEqual([{ path: '.claude/agents/fixer.md', content: 'F' }]);
    expect(d.gaps.some((g) => g.startsWith('.claude/settings/'))).toBe(false);
    expect(d.gaps).toContain('.claude/agents/reviewer.md is not shipped — no definition to provide');
  });

  it('ignores a shipped path no declared role names', () => {
    const d = composeRoleFiles({ ...ownCopies(), ...shipped }, {});
    expect(d.write.map((w) => w.path)).not.toContain('.claude/agents/a.md');
  });
});

describe('this repository as the shipped set', () => {
  it('carries a definition for every declared role', () => {
    for (const role of ROLE_NAMES) {
      expect(existsSync(join(repoRoot, roleDefinitionPath(role))), role).toBe(true);
    }
  });

  it('is received verbatim by a from-scratch repository', () => {
    const d = composeRoleFiles(ownCopies(), {});
    expect(d.gaps).toEqual([]);
    for (const w of d.write) {
      expect(w.content, w.path).toBe(readFileSync(join(repoRoot, w.path), 'utf8'));
    }
  });
});
