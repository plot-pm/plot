import { ROLE_NAMES } from './role-command.js';

/**
 * Which role definition files an adopting repository receives.
 *
 * A role is a `.claude/agents/<role>.md` definition plus, for roles that hold a
 * `Bash` or write tool, a `.claude/settings/<role>.json` gate. Adoption provides
 * the shipped copies and never overwrites a repository's own.
 *
 * This decides and renders nothing: the caller reads the shipped and present
 * contents, and acts on the answer.
 *
 * @concept adoption-roles
 */

/** One file adoption writes. */
export interface RoleFileWrite {
  /** The path, relative to the repository root. */
  readonly path: string;
  /** The content, byte for byte as shipped. */
  readonly content: string;
}

/** What adoption decided for the role files. */
export interface RoleFilesDecision {
  /** Files absent from the repository, to write. */
  readonly write: readonly RoleFileWrite[];
  /** Files present with different content, left untouched. */
  readonly stale: readonly string[];
  /** Files present with identical content. */
  readonly unchanged: readonly string[];
  /** What a person should look at: each stale path, and each definition with no shipped copy. */
  readonly gaps: readonly string[];
}

/** The definition path for a role. */
export const roleDefinitionPath = (role: string): string => `.claude/agents/${role}.md`;

/** The settings path for a role. */
export const roleSettingsPath = (role: string): string => `.claude/settings/${role}.json`;

/**
 * Every path a role set can provide, derived from {@link ROLE_NAMES}.
 *
 * @returns the definition and settings path of each declared role, in role order.
 */
export const roleFilePaths = (): readonly string[] =>
  ROLE_NAMES.flatMap((role) => [roleDefinitionPath(role), roleSettingsPath(role)]);

/**
 * Decide which role files an adopting repository gets.
 *
 * A settings path with no shipped copy is skipped: a role that holds no `Bash`
 * or write tool needs no hook. A definition with no shipped copy is a gap.
 *
 * @param shipped - the shipped content by path; a role file the plugin does not ship is absent.
 * @param present - the repository's content by path; an absent file is `null` or missing.
 * @returns the files to write, the stale ones left alone, and the gaps to report.
 */
export const composeRoleFiles = (
  shipped: Readonly<Record<string, string>>,
  present: Readonly<Record<string, string | null | undefined>>,
): RoleFilesDecision => {
  const write: RoleFileWrite[] = [];
  const stale: string[] = [];
  const unchanged: string[] = [];
  const gaps: string[] = [];
  for (const path of roleFilePaths()) {
    const content = shipped[path];
    if (content === undefined) {
      if (path.startsWith('.claude/agents/')) gaps.push(`${path} is not shipped — no definition to provide`);
      continue;
    }
    const existing = present[path];
    if (existing === null || existing === undefined) write.push({ path, content });
    else if (existing === content) unchanged.push(path);
    else {
      stale.push(path);
      gaps.push(`${path} differs from the shipped copy (stale) — left as it is`);
    }
  }
  return { write, stale, unchanged, gaps };
};
