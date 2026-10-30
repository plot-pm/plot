/**
 * The command a declared role run issues, and the JSON definition it loads.
 *
 * A role is a `.claude/agents/<role>.md` file on the default branch plus a
 * per-role settings file. `claude --agents` takes a JSON object, not that
 * frontmatter file, so {@link roleAgentsJson} translates one into the other;
 * {@link roleCommand} builds the shell fragment that loads it.
 *
 * @concept role-command
 */

/** The four declared roles. */
export const ROLE_NAMES = ['reviewer', 'fixer', 'unblocker', 'main-repair'] as const;

/** A declared role's name. */
export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * A role run's identity, carried on `AgentRunRequest.roleAgent`.
 *
 * Both files are absolute paths outside the run's tree, written from the
 * default branch's copy.
 */
export interface RoleAgentRef {
  /** The declared role. */
  readonly name: RoleName;
  /** The JSON file {@link roleAgentsJson} produced, passed as `--agents`. */
  readonly agentsFile: string;
  /** The role's settings file, passed as `--settings`. */
  readonly settingsFile: string;
}

/** A path the role command accepts; it is single-quoted into the command. */
const singleQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** What `roleCommand` answers: the shell fragment, or the reason none is built. */
export type RoleCommand = { read: 'command'; command: string } | { read: 'refused'; why: string };

/**
 * The shell fragment that runs one declared role, for the `command` agent
 * runner. The prompt follows it as an argument.
 *
 * The fragment loads user settings only (`--setting-sources user`, so nothing
 * from the reviewed or fixed tree applies), selects the role with `--agent`,
 * and bounds the session with `--max-turns`: the `maxTurns` key inside
 * `--agents` bounds only a sub-agent a session spawns, not a session started
 * as the role (measured 2026-10-29: `maxTurns: 1` ran to 4 and 6 turns;
 * `--max-turns 1` ended the run at its first tool call).
 *
 * @param role - the role's files.
 * @param maxTurns - the session's turn limit; `0` for none.
 * @returns the fragment, or a refusal for a name that is not a declared role
 *   or a turn limit that is not a whole number.
 */
export const roleCommand = (role: RoleAgentRef, maxTurns: number): RoleCommand => {
  if (!(ROLE_NAMES as readonly string[]).includes(role.name)) {
    return { read: 'refused', why: `'${role.name}' is not a declared role` };
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 0) {
    return { read: 'refused', why: `the turn limit '${maxTurns}' is not a whole number` };
  }
  const command = [
    'claude',
    '-p',
    '--setting-sources',
    'user',
    '--agent',
    role.name,
    '--agents',
    singleQuote(role.agentsFile),
    '--settings',
    singleQuote(role.settingsFile),
    ...(maxTurns > 0 ? ['--max-turns', String(maxTurns)] : []),
  ].join(' ');
  return { read: 'command', command };
};

/** What `roleAgentsJson` answers: the `--agents` JSON text, or the reason none is built. */
export type RoleAgentsJson = { read: 'json'; json: string } | { read: 'refused'; why: string };

/** The frontmatter keys the `--agents` JSON object accepts and the role files use. */
const JSON_KEYS: ReadonlySet<string> = new Set([
  'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills', 'memory', 'effort',
]);

/** One frontmatter scalar: a number where it is written as one, else the text. */
const scalar = (text: string): string | number => (/^[0-9]+$/.test(text) ? Number(text) : text.replace(/^(['"])(.*)\1$/, '$2'));

/**
 * Translates a role's definition file into the `--agents` JSON object.
 *
 * The frontmatter's `description`, `model`, `effort`, `maxTurns`, `memory`
 * and `tools` carry over; the body becomes `prompt`. The frontmatter's own
 * `prompt` and `isolation` keys are not carried: `prompt` names a path while
 * the JSON wants the text, and fleetd creates every worktree itself.
 *
 * @param name - the role.
 * @param text - the definition file's text.
 * @returns the JSON text naming exactly one agent, or a refusal when the file
 *   has no frontmatter, no `description` or no body.
 */
export const roleAgentsJson = (name: RoleName, text: string): RoleAgentsJson => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (match === null) return { read: 'refused', why: `the ${name} definition has no frontmatter` };
  const definition: Record<string, unknown> = {};
  let list: string | null = null;
  for (const line of match[1]!.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item !== null && list !== null) {
      (definition[list] as unknown[]).push(scalar(item[1]!.trim()));
      continue;
    }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const key = pair[1]!;
    const value = pair[2]!.trim();
    list = null;
    if (!JSON_KEYS.has(key)) continue;
    if (value === '') {
      definition[key] = [];
      list = key;
    } else definition[key] = scalar(value);
  }
  const prompt = match[2]!.trim();
  if (typeof definition.description !== 'string' || definition.description === '') {
    return { read: 'refused', why: `the ${name} definition names no description` };
  }
  if (prompt === '') return { read: 'refused', why: `the ${name} definition has no body to use as its prompt` };
  return { read: 'json', json: JSON.stringify({ [name]: { ...definition, prompt } }) };
};
