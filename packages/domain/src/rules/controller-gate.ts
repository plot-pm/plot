/**
 * What the controller gate reads of a command, and what it says when it
 * refuses. `controllerInvocation` (`ci-suite.ts`) decides which action a
 * command runs; this file holds the other pure parts of the gate: the
 * heredoc strip, the prefilter, the unpinned-merge reading and the refusal
 * texts.
 */
import { isReadSegment, programWords, withoutQuotes, wordBasename } from './ci-suite.js';

/** The actions a controller owns. */
export type ControllerAction = 'dispatch' | 'approve' | 'deliver' | 'release';

/**
 * Removes the body of every single-quoted heredoc (`<<'EOF'` or `<<-'EOF'`),
 * which is data. The line that opens the heredoc and the terminator line stay;
 * an unquoted or double-quoted heredoc keeps its body, because it can hold a
 * command substitution.
 *
 * @param command - the command line.
 * @returns the command without those bodies.
 */
export const withoutQuotedHeredocs = (command: string): string => {
  const kept: string[] = [];
  let tag: string | null = null;
  for (const line of command.split('\n')) {
    if (tag === null) {
      tag = /<<-?[ \t]*'([^']+)'/.exec(line)?.[1] ?? null;
      kept.push(line);
    } else if (line.replace(/^\t+/, '') === tag) {
      tag = null;
      kept.push(line);
    }
  }
  return kept.join('\n');
};

/**
 * Whether a command could name a controller-owned script or merge a pull
 * request. A word passes when it contains `plot-dispatch`, `plot-approve` or
 * `plot-deliver`, when it ends `.sh` or `.mjs` and holds a glob character, or
 * when it is `merge` or `pr-merge`. The test may over-pass and never
 * under-passes: it only decides whether the full reading is worth its cost.
 *
 * @param command - the command line.
 * @returns whether the full reading should run.
 */
export const mayRunController = (command: string): boolean =>
  command.split(/\s+/).some(
    (word) =>
      /plot-(dispatch|approve|deliver)/.test(word) ||
      /\.(sh|mjs)$/.test(word) && /[*?[\]]/.test(word) ||
      word === 'merge' ||
      word === 'pr-merge',
  );

/** Whether a word pins a merge to the head it reviewed. */
const isPin = (word: string): boolean => word.startsWith('--match-head');

/**
 * Whether a command merges a pull request without pinning the head it
 * reviewed: `gh pr merge` or the host helper's `pr-merge`, with no
 * `--match-head` or `--match-head-commit` among its words. A segment whose
 * program is `ls`, `cat` or `git grep` is a read.
 *
 * @param command - the command line, with any single-quoted heredoc body stripped.
 * @returns whether a segment merges with no pin.
 */
export const unpinnedMerge = (command: string): boolean =>
  withoutQuotes(command)
    .split(/&&|\|\||[;|\n]/)
    .some((segment) => {
      const words = segment.trim().split(/\s+/).filter((word) => word !== '');
      if (words.length === 0 || isReadSegment(words)) return false;
      const program = programWords(words);
      const viaGh = wordBasename(program[0] ?? '') === 'gh' && program.some((w, i) => w === 'pr' && program[i + 1] === 'merge');
      const viaHost = program.some((w) => /^plot-host\.sh$/.test(wordBasename(w))) && program.includes('pr-merge');
      return (viaGh || viaHost) && !words.some(isPin);
    });

/** Quotes a path for a shell, leaving a plain one bare. */
const shellQuote = (value: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/** The HTTP request each action's button sends. */
const ENDPOINT: Record<ControllerAction, string> = {
  dispatch: 'POST /api/dispatch {"slug":"<slug>"}',
  approve: 'POST /api/approve {"slug":"<slug>"}',
  deliver: 'POST /api/deliver {"slug":"<slug>"}',
  release: 'POST /api/release {"slug":"<slug>","version":"<version>"}',
};

/**
 * The refusal for a controller-owned action called with no controller receipt.
 * It names the HTTP endpoint first and the receipt escape second. Only
 * dispatch has a board-free bundle to name; `approve` and `deliver` take
 * `--who`/`--release` modes the gate itself reads as a run, so the text does
 * not send the reader to them.
 *
 * @param action - the action the command runs.
 * @param scriptDir - the absolute directory holding the plot scripts.
 * @returns the text for stderr.
 */
export const controllerRefusal = (action: ControllerAction, scriptDir: string): string => {
  const owner = action === 'release' ? 'deliver' : action;
  const named = `plot-${owner}.sh`;
  const lines = [`plot-controller-gate: ${named} is a controller-owned action.`, '', '  Call the controller instead:'];
  if (action === 'dispatch') {
    lines.push(`      node ${shellQuote(`${scriptDir}/board/plot-dispatch-command.mjs`)} <slug>`);
    lines.push(`    which runs with no board. With the board up, ${ENDPOINT[action]} is its button, and /plot-dispatch asks it.`);
  } else {
    lines.push(`      ${ENDPOINT[action]}`);
    lines.push(`    which is the board's button, and /plot-${owner} asks it.`);
  }
  lines.push(
    '',
    '  Or, where the board is not running and you accept the bypass, run these as TWO calls, in this order:',
    `      1. bash ${shellQuote(`${scriptDir}/plot-state-receipt.sh`)} --unowned-action ${action} <slug> "<reason>"`,
    `      2. the ${action} command you meant`,
    '    A chained `receipt && command` is checked before either runs, and is refused. The receipt stays until the',
    '    action exits 0.',
    '',
    '  The reason is required and it is counted to .plot/state/unowned-action-writes.tsv, because a gate with no',
    '  exit is one people route around and an uncounted exit is an off switch.',
    '',
  );
  return lines.join('\n');
};

/**
 * The refusal for a merge with no head pin.
 *
 * @param scriptDir - the absolute directory holding the plot scripts.
 * @returns the text for stderr.
 */
export const unpinnedMergeRefusal = (scriptDir: string): string =>
  [
    'plot-controller-gate: a merge must be pinned to the head that was reviewed.',
    '',
    '  Merge through the controller, which re-asks the host and merges pinned to <sha> or refuses by name:',
    `      node ${shellQuote(`${scriptDir}/board/plot-ask.mjs`)} merge <pr> <sha>`,
    '  Or add --match-head-commit <sha> to the merge you meant.',
    '',
  ].join('\n');
