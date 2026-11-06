import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Refs } from '@plot-pm/domain/ports/refs';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { roleAgentsJson, type RoleName } from '@plot-pm/domain/rules/role-command';

/** What {@link roleFilesAt} reads and acts through. */
export interface RoleFilesDeps {
  /** The repository root; `Trees.fetch` runs there. */
  repoRoot: string;
  trees: Pick<Trees, 'fetch'>;
  refs: Pick<Refs, 'defaultBranch' | 'showFile'>;
}

/** What {@link roleFilesAt} is asked to load. */
export interface RoleFilesInput<Settings extends boolean = boolean> {
  /** The declared role. */
  role: RoleName;
  /** The directory the role's `agents.json` and `settings.json` are written to, absolute. */
  outDir: string;
  /** Whether the role has a `.claude/settings/<role>.json`; `true` refuses where it is absent. */
  settings: Settings;
}

/**
 * The files a role run starts from, written under the caller's directory.
 * `settingsFile` is a path where the input said `settings: true` and `undefined` otherwise.
 */
export type RoleFilesRead<Settings extends boolean = boolean> =
  | {
      read: 'files';
      agentsFile: string;
      settingsFile: Settings extends true ? string : undefined;
      /** The `maxTurns` the definition declares; `0` where it declares none. */
      maxTurns: number;
    }
  | { read: 'refused'; why: string };

/**
 * The turn limit a role definition declares in its frontmatter.
 *
 * @param text - the definition file's text.
 * @returns the `maxTurns` value, or `0` (no limit) where the key is absent.
 */
export const maxTurnsOfRole = (text: string): number => {
  const match = /^maxTurns:\s*(\d+)\s*$/m.exec(text);
  return match ? Number(match[1]) : 0;
};

/**
 * Loads a role's files from the freshly fetched default branch.
 *
 * Fetches the default branch with `Trees.fetch` first, then reads
 * `.claude/agents/<role>.md` and, where `settings` is set,
 * `.claude/settings/<role>.json` from `origin/<default>` through
 * `Refs.showFile`. Writes `agents.json` (through `roleAgentsJson`) and
 * `settings.json` into `outDir` only after every read succeeded, so a refusal
 * leaves `outDir` as it was.
 *
 * @param deps - the ports and the repository root.
 * @param input - the role, the output directory and whether the role has settings.
 * @returns the written paths and the declared turn limit, or a refusal:
 *   `default-branch-unread`, `default-branch-unfetched`, a sentence naming a
 *   file that is not on `origin/<default>`, or the reason `roleAgentsJson` refused.
 */
export const roleFilesAt = async <Settings extends boolean>(
  deps: RoleFilesDeps,
  input: RoleFilesInput<Settings>,
): Promise<RoleFilesRead<Settings>> => {
  const base = await deps.refs.defaultBranch();
  if (!base.ok) return { read: 'refused', why: 'default-branch-unread' };
  const fetched = await deps.trees.fetch(deps.repoRoot, base.value);
  if (!fetched.ok) return { read: 'refused', why: 'default-branch-unfetched' };
  const ref = `origin/${base.value}`;
  const definitionPath = `.claude/agents/${input.role}.md`;
  const definition = await deps.refs.showFile(ref, definitionPath);
  if (!definition.ok) return { read: 'refused', why: `${definitionPath} is not on ${ref}` };
  let settingsText: string | undefined;
  if (input.settings) {
    const settingsPath = `.claude/settings/${input.role}.json`;
    const settings = await deps.refs.showFile(ref, settingsPath);
    if (!settings.ok) return { read: 'refused', why: `${settingsPath} is not on ${ref}` };
    settingsText = settings.value;
  }
  const json = roleAgentsJson(input.role, definition.value);
  if (json.read === 'refused') return { read: 'refused', why: json.why };
  mkdirSync(input.outDir, { recursive: true });
  const agentsFile = join(input.outDir, 'agents.json');
  writeFileSync(agentsFile, json.json);
  let settingsFile: string | undefined;
  if (settingsText !== undefined) {
    settingsFile = join(input.outDir, 'settings.json');
    writeFileSync(settingsFile, settingsText);
  }
  return { read: 'files', agentsFile, settingsFile: settingsFile as Settings extends true ? string : undefined, maxTurns: maxTurnsOfRole(definition.value) };
};
