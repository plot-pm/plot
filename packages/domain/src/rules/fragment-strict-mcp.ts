/** `--strict-mcp-config` as a whole token: preceded by start or whitespace, followed by end or whitespace. */
const STRICT_MCP_FLAG = /(?:^|\s)--strict-mcp-config(?=\s|$)/;

/**
 * Answers whether a command fragment names `--strict-mcp-config`.
 *
 * @param fragment - the command fragment, verbatim; `''` where the role has none.
 * @returns `true` where the fragment carries the flag as a whole word, and
 *   `false` for an empty fragment, a fragment without it, and a longer flag
 *   such as `--strict-mcp-config-x`.
 */
export const fragmentStrictMcp = (fragment: string): boolean => STRICT_MCP_FLAG.test(fragment);
