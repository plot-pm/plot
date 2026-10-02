/**
 * Whether a shell command runs a suite the project leaves to CI.
 *
 * A project lists those suites in the `CI suites` config key. An agent at a
 * fleet desk that starts one is refused, with the local checks command to run
 * instead. The match reads only where a command runs: a `grep`, a commit
 * message or a PR body that mentions a suite passes.
 */

/** A refused command, naming the suite it starts. */
export interface CiSuiteRefusal {
  readonly suite: string;
}

/** A leading `NAME=value` assignment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;

/**
 * Removes quoted text, so a suite named inside quotes is not read as run.
 *
 * @param command - the command line.
 * @returns the command with every quoted span emptied.
 */
export const withoutQuotes = (command: string): string =>
  command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');

/**
 * Strips what precedes the program a simple command runs: `NAME=value`
 * assignments, and `env` with its options and assignments.
 *
 * @param words - one simple command, split on whitespace.
 * @returns the words from the program on.
 */
export const programWords = (words: readonly string[]): string[] => {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i])) i += 1;
  if (words[i] === 'env') {
    i += 1;
    while (i < words.length) {
      const word = words[i];
      if (word === '-u' || word === '--unset' || word === '-C' || word === '--chdir') i += 2;
      else if (word.startsWith('-') || ASSIGNMENT.test(word)) i += 1;
      else break;
    }
  }
  return words.slice(i);
};

/**
 * Decides whether a command runs one of the suites.
 *
 * The command is split into simple commands on `&&`, `||`, `;`, `|` and new
 * lines, after quoted text is removed. A simple command runs a suite when its
 * words, from the program on, begin with that suite's words.
 *
 * @param command - the command line an agent is about to run.
 * @param suites - the `CI suites` entries.
 * @returns the refusal, or `null` when the command runs none of them.
 */
export const ciSuiteRefusal = (command: string, suites: readonly string[]): CiSuiteRefusal | null => {
  const entries = suites.map((suite) => ({ suite, words: suite.trim().split(/\s+/) })).filter((e) => e.words[0] !== '');
  if (entries.length === 0) return null;
  const segments = withoutQuotes(command).split(/&&|\|\||[;|\n]/);
  for (const segment of segments) {
    const words = programWords(segment.trim().split(/\s+/).filter((word) => word !== ''));
    for (const entry of entries) {
      if (entry.words.length <= words.length && entry.words.every((word, i) => words[i] === word)) {
        return { suite: entry.suite };
      }
    }
  }
  return null;
};
