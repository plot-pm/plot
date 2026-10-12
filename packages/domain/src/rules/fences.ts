/**
 * Which lines of a Markdown text lie inside a fenced code block.
 */

/** Matches a fence line: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Marks the lines of a Markdown text that lie inside a fenced code block.
 *
 * A fence opens on a line of three or more backticks or tildes, indented by at
 * most three spaces; a backtick fence whose info string holds a backtick opens
 * none. It closes on a line of the same character, at least as long as the
 * opener, followed by nothing but whitespace. An unclosed fence runs to the end
 * of the text. The opening and the closing line count as fenced.
 *
 * @param lines - the text, split at `\n`.
 * @returns one flag per line, `true` where the line is fenced.
 */
export const fencedLines = (lines: readonly string[]): readonly boolean[] => {
  const fenced: boolean[] = [];
  let open = '';
  for (const line of lines) {
    const fence = FENCE.exec(line);
    const run = fence?.[1] ?? '';
    const rest = line.slice(fence?.[0].length ?? 0);
    if (open === '') {
      if (run !== '' && !(run[0] === '`' && rest.includes('`'))) open = run;
      fenced.push(open !== '');
      continue;
    }
    fenced.push(true);
    if (run[0] === open[0] && run.length >= open.length && rest.trim() === '') open = '';
  }
  return fenced;
};
