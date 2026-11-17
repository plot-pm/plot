/**
 * The command a declared role run issues, and the JSON definition it loads.
 *
 * A role is a `.claude/agents/<role>.md` file on the default branch plus a
 * per-role settings file. `claude --agents` takes a JSON object, not that
 * frontmatter file, so {@link roleAgentsJson} translates one into the other;
 * {@link roleCommand} builds the shell fragment that loads it. The fragment
 * contains a command substitution, so it needs a bash runner (the `command`
 * agent runner runs it as `bash -c '<fragment> "$@"'`).
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
  /** The JSON file {@link roleAgentsJson} produced; its text is passed as `--agents`. */
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
 * `--agents` carries the JSON text, not a path: the fragment substitutes the
 * agents file's contents with `"$(cat -- '<agentsFile>')"`, which the
 * Claude Code CLI (2.1.231) requires. A missing file substitutes empty text,
 * which the CLI refuses. The fragment needs a bash runner.
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
 * @param tools - the role's declared tools ({@link roleTools}). A non-empty
 *   list adds one `--allowedTools '<comma-joined>'` argument before
 *   `--settings`, because the flag is variadic and a trailing one reads the
 *   next argument as a tool name. An empty list adds nothing.
 * @returns the fragment, or a refusal for a name that is not a declared role
 *   or a turn limit that is not a whole number.
 */
export const roleCommand = (role: RoleAgentRef, maxTurns: number, tools: readonly string[] = []): RoleCommand => {
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
    `"$(cat -- ${singleQuote(role.agentsFile)})"`,
    ...(tools.length > 0 ? ['--allowedTools', singleQuote(tools.join(','))] : []),
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

/** A definition file's accepted frontmatter keys and its body; `null` without frontmatter. */
const parseDefinition = (text: string): { definition: Record<string, unknown>; body: string } | null => {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (match === null) return null;
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
  return { definition, body: match[2]! };
};

/**
 * The tools a role's definition declares, read by the parser
 * {@link roleAgentsJson} uses.
 *
 * @param text - the definition file's text.
 * @returns the `tools` list as strings; `[]` for no frontmatter, no `tools`
 *   key or an empty list.
 */
export const roleTools = (text: string): readonly string[] => {
  const tools = parseDefinition(text)?.definition.tools;
  return Array.isArray(tools) ? tools.map(String) : [];
};

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
  const parsed = parseDefinition(text);
  if (parsed === null) return { read: 'refused', why: `the ${name} definition has no frontmatter` };
  const { definition, body } = parsed;
  const prompt = body.trim();
  if (typeof definition.description !== 'string' || definition.description === '') {
    return { read: 'refused', why: `the ${name} definition names no description` };
  }
  if (prompt === '') return { read: 'refused', why: `the ${name} definition has no body to use as its prompt` };
  return { read: 'json', json: JSON.stringify({ [name]: { ...definition, prompt } }) };
};
