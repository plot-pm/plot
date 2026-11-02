import { scriptsShell, trackerForIssues, hostShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import {
  REVIEW_ISSUE_LABEL,
  readTicketVerdict,
  reviewTicketSettled,
  ticketStayOpenComment,
  TICKET_TRIAGE_MARKER,
} from '@plot-pm/domain/rules/review-issue';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * Triages the open review finding tickets against their recorded verdicts.
 *
 * ```
 * plot-finding-tickets.mjs          # dry run: close / comment / skip per ticket, and the call count
 * plot-finding-tickets.mjs --yes    # write
 * ```
 *
 * A verdict is `.plot/state/ticket-verdicts/<issue>.md`. A `settled` ticket is
 * closed. An `open` ticket gets one marked comment, edited in place and written
 * only when its text differs from the last text written. An `unjudged` ticket
 * is left alone. A merge, a PR state and the PR index are never read.
 *
 * The ticket body is read (`issueView`) only for a ticket that has a verdict
 * file, because the body carries the ticket's `Findings:` total; a ticket with
 * no verdict costs no call beyond the one list.
 *
 * `--yes` refuses under `PLOT_UNATTENDED=1` (exit 2) before it reads anything.
 */

/** The exit codes the caller reads. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

/** The title the review tickets carry. */
export const TITLE_HAS = 'plot-review: findings on';

/** How many open tickets one run reads at most. */
export const LIST_LIMIT = 1000;

/** Everything the entry reads from outside itself. */
export interface Deps {
  tracker: Tracker;
  /** The verdict file's text for an issue, or null where there is none. */
  verdict: (issue: string) => string | null;
  /** The hash of the last stay-open comment written for an issue, or null. */
  lastWritten: (issue: string) => string | null;
  /** Records the hash of the stay-open comment just written. */
  recordWritten: (issue: string, hash: string) => void;
  env: Record<string, string | undefined>;
  write: (s: string) => void;
  warn: (s: string) => void;
}

const USAGE = 'usage: plot-finding-tickets.mjs [--yes]';

const hashOf = (body: string): string => createHash('sha256').update(body).digest('hex');

/**
 * Runs the triage.
 *
 * @param argv - the arguments after the script name.
 * @param deps - the tracker, the verdict and hash stores, the environment and the outputs.
 * @returns the process exit code.
 */
export const run = async (argv: readonly string[], deps: Deps): Promise<number> => {
  const unknown = argv.find((arg) => arg !== '--yes');
  if (unknown !== undefined) {
    deps.warn(`plot-finding-tickets: unknown argument '${unknown}'\n${USAGE}\n`);
    return EXIT.usage;
  }
  const yes = argv.includes('--yes');
  if (yes && deps.env.PLOT_UNATTENDED === '1') {
    deps.warn('plot-finding-tickets: --yes writes to the tracker and needs a person; refused under PLOT_UNATTENDED=1\n');
    return EXIT.usage;
  }
  const listed = await deps.tracker.issueListWithTitle(REVIEW_ISSUE_LABEL, TITLE_HAS, LIST_LIMIT);
  if (!listed.ok) {
    if (listed.why === 'unaskable') {
      deps.write(`not checked: ${listed.reason ?? 'the tracker cannot list issues'}; nothing was read or written\n`);
      return EXIT.ok;
    }
    deps.warn('plot-finding-tickets: the open tickets could not be read; nothing was changed\n');
    return EXIT.failed;
  }
  if (!listed.value.complete) deps.warn('plot-finding-tickets: note: the ticket read stopped at its limit\n');

  let closes = 0;
  let comments = 0;
  let unjudged = 0;
  let failed = false;
  for (const issue of listed.value.issues) {
    const verdictText = deps.verdict(issue.id);
    if (verdictText === null) {
      unjudged += 1;
      deps.write(`skip\t${issue.id}\tunjudged\n`);
      continue;
    }
    const viewed = await deps.tracker.issueView(issue.id);
    if (!viewed.ok) {
      deps.warn(`plot-finding-tickets: ${issue.id}: the ticket could not be read (${viewed.why})\n`);
      failed = true;
      continue;
    }
    const settlement = reviewTicketSettled(viewed.value, verdictText);
    if (settlement === 'unjudged') {
      unjudged += 1;
      deps.write(`skip\t${issue.id}\tunjudged\n`);
      continue;
    }
    if (settlement === 'settled') {
      closes += 1;
      deps.write(`close\t${issue.id}\n`);
      if (!yes) continue;
      const result = await deps.tracker.issueClose(issue.id);
      if (!result.ok) {
        deps.warn(`plot-finding-tickets: ${issue.id}: close failed: ${deps.tracker.lastRefusal() ?? result.why}\n`);
        failed = true;
      }
      continue;
    }
    const verdict = readTicketVerdict(verdictText);
    if (verdict === null) continue;
    const body = ticketStayOpenComment(verdict);
    const hash = hashOf(body);
    if (deps.lastWritten(issue.id) === hash) {
      deps.write(`skip\t${issue.id}\tcomment-unchanged\n`);
      continue;
    }
    comments += 1;
    deps.write(`comment\t${issue.id}\n`);
    if (!yes) continue;
    const result = await deps.tracker.issueComment(issue.id, body, TICKET_TRIAGE_MARKER);
    if (result.ok) deps.recordWritten(issue.id, hash);
    else {
      deps.warn(`plot-finding-tickets: ${issue.id}: comment failed: ${deps.tracker.lastRefusal() ?? result.why}\n`);
      failed = true;
    }
  }
  deps.write(`summary: close=${closes} comment=${comments} unjudged=${unjudged}\n`);
  if (!yes && closes + comments > 0) deps.write('dry run: nothing was written; re-run with --yes to write\n');
  return failed ? EXIT.failed : EXIT.ok;
};

/** The hash record's filename under `.plot/state/`. */
const WRITTEN_FILE = 'ticket-triage-written.json';

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const scriptDir = process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..');
  const context: ShellContext = { repoRoot, scriptDir };
  const [declared, backend] = await Promise.all([scriptsShell(context).config('Tracker', ''), hostShell(context).backend()]);
  const tracker = trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
  const stateDir = path.join(repoRoot, '.plot', 'state');
  const writtenPath = path.join(stateDir, WRITTEN_FILE);
  const readWritten = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(writtenPath, 'utf8'));
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  };
  void endEntry(
    await run(process.argv.slice(2), {
      tracker,
      verdict: (issue) => {
        try {
          return readFileSync(path.join(stateDir, 'ticket-verdicts', `${issue.replace(/^#/, '').replace(/[^A-Za-z0-9_-]/g, '_')}.md`), 'utf8');
        } catch {
          return null;
        }
      },
      lastWritten: (issue) => readWritten()[issue] ?? null,
      recordWritten: (issue, hash) => {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(writtenPath, `${JSON.stringify({ ...readWritten(), [issue]: hash }, null, 2)}\n`, 'utf8');
      },
      env: process.env,
      write: (s) => process.stdout.write(s),
      warn: (s) => process.stderr.write(s),
    }),
  );
}
