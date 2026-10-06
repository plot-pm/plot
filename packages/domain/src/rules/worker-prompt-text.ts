/**
 * The worker prompt the SDK runner sends, read as text from a Markdown file.
 *
 * The `command` runner sources a shell prompt (`.plot/worker-prompt.sh`); the
 * SDK runner reads a `.md` file and fills three placeholders. A project's
 * `.sh` and `.md` hold the same project text for the two runners, a declared
 * duplicate.
 */

/** The project's own prompt file for the SDK runner, relative to the repository root. */
export const PROJECT_WORKER_PROMPT_MD = '.plot/worker-prompt.md';

/**
 * The repository-relative files the SDK runner reads its prompt from, in
 * order; the first that exists wins, and none existing reads Plot's shipped
 * template.
 *
 * A charter's prompt file wins. A charter names a `.sh` prompt for the
 * `command` runner, so its `.md` sibling stands in for it on the SDK runner.
 *
 * @param charterPrompt - the prompt the charter declares; `''` where the agent has no charter.
 * @returns the candidates, without duplicates.
 */
export const promptCandidates = (charterPrompt: string): string[] => {
  const charter = charterPrompt === '' ? [] : [charterPrompt.replace(/\.sh$/, '.md')];
  return [...new Set([...charter.filter((p) => p.endsWith('.md')), PROJECT_WORKER_PROMPT_MD])];
};

/** A prompt file, split into its body and its front matter's deny list. */
export interface PromptFile {
  /** The text after the front matter. */
  readonly body: string;
  /** The tools `read-only-deny` names; `null` where the front matter names none. */
  readonly readOnlyDeny: readonly string[] | null;
}

/**
 * Splits a prompt file into its front matter's `read-only-deny` list and its body.
 *
 * @param text - the file's text.
 * @returns the body, trimmed, and the deny list.
 */
export const parsePromptFile = (text: string): PromptFile => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match === null) return { body: text.trim(), readOnlyDeny: null };
  const line = match[1]!.split('\n').find((l) => l.startsWith('read-only-deny:'));
  const readOnlyDeny =
    line === undefined
      ? null
      : line
          .slice('read-only-deny:'.length)
          .split(',')
          .map((tool) => tool.trim())
          .filter((tool) => tool !== '');
  return { body: text.slice(match[0].length).trim(), readOnlyDeny };
};

/**
 * Fills a prompt body's `{branch}`, `{brief}` and `{scripts}` placeholders.
 *
 * @param body - the prompt body.
 * @param branch - the branch the agent implements.
 * @param scripts - Plot's script directory.
 * @returns the prompt text; `{brief}` reads `.plot/briefs/<last branch segment>.md`.
 */
export const renderPrompt = (body: string, branch: string, scripts: string): string =>
  body
    .replaceAll('{branch}', branch)
    .replaceAll('{brief}', `.plot/briefs/${branch.split('/').pop()}.md`)
    .replaceAll('{scripts}', scripts);
