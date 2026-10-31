import path from 'node:path';
import fs from 'node:fs';

import { slicePrNext, type SlicePrNextReadings, type SlicePrStep } from '@plot-pm/domain';
import { fixerAttemptsExhausted, fixerInFlight } from '@plot-pm/domain/rules/fixer-attempts';
import { reviewVerdict, type ReviewCounts } from '@plot-pm/domain/rules/review-verdict';
import { REVIEW_ISSUE_LABEL, reviewIssueTitle } from '@plot-pm/domain/rules/review-issue';
import {
  REVIEW_STATUS_CONTEXT,
  reviewStatus,
  ticketFindingsBody,
  ticketReading,
} from '@plot-pm/domain/rules/ticket';
import { TICKET_RECORD_VERSION, type TicketRecord } from '@plot-pm/domain/entities/ticket-record';
import type { FixerAttemptsRecord } from '@plot-pm/domain/entities/fixer-attempts';
import type { PrIndexRow } from '@plot-pm/domain/entities/pr-index';
import type { FixerAttemptsStore } from '@plot-pm/domain/ports/fixer-attempts';
import type { TicketRecordStore } from '@plot-pm/domain/ports/ticket-record';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import {
  fixerAttemptsFile,
  hostShell,
  scriptsShell,
  ticketRecordFile,
  trackerForIssues,
} from '@plot-pm/domain/adapters';
import { reviewVerdictPath, readFixerPass, type FixerPassReading } from './auto-fixer.js';
import { runLogOf, type ActOptions } from './action-log.js';

/** The readings one tick hands {@link ticketTick} besides the PR's own. */
export type TicketTickReadings = Omit<SlicePrNextReadings, 'row' | 'desk' | 'fixer' | 'ticket'>;

/** What the ticket tick reads and acts through; a test replaces each. */
export interface TicketTickWorld {
  readonly attempts: (opts: ActOptions) => Pick<FixerAttemptsStore, 'read'>;
  readonly tickets: (opts: ActOptions) => TicketRecordStore;
  readonly tracker: (opts: ActOptions) => Promise<Pick<Tracker, 'issueOpen' | 'issueComment' | 'lastRefusal'>>;
  readonly host: (opts: ActOptions) => Pick<Host, 'commitStatus'>;
  /** Reads a review verdict file; `null` for a file that cannot be read. */
  readonly readVerdictFile: (file: string) => string | null;
  /** Tells a person what the tick could not do; `console.error` by default. */
  readonly notify: (message: string) => void;
}

/** What a ticket or status write came to. */
export type TicketActOutcome = { done: true } | { done: false; why: string };

/** What one tick did for one PR. */
export interface TicketTickResult {
  readonly pr: number;
  readonly step: SlicePrStep;
  /** Set where the step was `ticket` or `write-status` with `ticket-accepted`. */
  readonly acted?: TicketActOutcome;
}

const refused = (why: string): TicketActOutcome => ({ done: false, why });

/** Counts from the head's verdict file, or the reason none could be read. */
const countsFor = (
  world: TicketTickWorld,
  opts: ActOptions,
  pr: number,
  head: string,
): { counts: ReviewCounts; text: string } | { why: string } => {
  const text = world.readVerdictFile(reviewVerdictPath(opts.repoRoot, pr, head));
  if (text === null) return { why: 'findings-unread' };
  const verdict = reviewVerdict(text);
  return verdict.read === 'counted' ? { counts: verdict.counts, text } : { why: 'findings-refused' };
};

/**
 * Puts a head's HIGH findings on the PR's one ticket.
 *
 * With no record, writes `pending`, asks the tracker to open the issue, and
 * overwrites `pending` with the id. With an opened record, adds the head's
 * findings as a comment. A `pending` record is never retried: the open call
 * may have landed, so the file is named for a person to check.
 *
 * @param world - the tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row.
 * @param head - the head the findings belong to.
 * @param now - epoch milliseconds.
 * @returns whether the findings reached a ticket and are recorded.
 */
const putOnTicket = async (
  world: TicketTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  head: string,
  now: number,
): Promise<TicketActOutcome> => {
  const found = countsFor(world, opts, row.number, head);
  if ('why' in found) return refused(found.why);
  const body = ticketFindingsBody(head, row.url, found.counts, found.text);
  const store = world.tickets(opts);
  const read = await store.read(row.number);
  if (!read.ok || read.value === 'unreadable') return refused('record-unread');
  const record = read.value;
  if (record !== 'none' && record.ticket === 'pending') return refused('ticket-pending');
  const tracker = await world.tracker(opts);

  if (record === 'none') {
    const marked = await store.write(row.number, {
      v: TICKET_RECORD_VERSION,
      pr: row.number,
      ticket: 'pending',
      at: new Date(now).toISOString(),
    });
    if (!marked.ok) return refused('record-failed');
    const opened = await tracker.issueOpen({
      title: reviewIssueTitle(row.number),
      body,
      labels: [REVIEW_ISSUE_LABEL],
    });
    if (!opened.ok) {
      const reason = tracker.lastRefusal() ?? '';
      // ONLY A REFUSAL THAT PROVES NO ISSUE EXISTS CLEARS THE MARK: `unaskable`
      // sent nothing, and `failed` without the prefix was refused or never sent.
      if (opened.why === 'unaskable' || !reason.startsWith('the issue may exist: ')) {
        await store.clear(row.number);
        return refused(opened.why === 'unaskable' ? 'tracker-unaskable' : 'open-failed');
      }
      world.notify(
        `plot-fleetd: PR #${row.number}: the ticket may exist; check ${path.join('.plot', 'state', 'tickets', `${row.number}.json`)}`,
      );
      return refused('ticket-pending');
    }
    const confirmed = await store.write(row.number, {
      v: TICKET_RECORD_VERSION,
      pr: row.number,
      ticket: 'opened',
      id: opened.value.id,
      heads: [head],
    });
    if (!confirmed.ok) {
      world.notify(
        `plot-fleetd: PR #${row.number}: ticket ${opened.value.id} opened but its record is still pending; check ${path.join('.plot', 'state', 'tickets', `${row.number}.json`)}`,
      );
      return refused('record-failed');
    }
    return { done: true };
  }

  if (record.heads.includes(head)) return { done: true };
  const commented = await tracker.issueComment(record.id, body);
  if (!commented.ok) return refused(commented.why === 'unaskable' ? 'tracker-unaskable' : 'comment-failed');
  const next: TicketRecord = { ...record, heads: [...record.heads, head] };
  const kept = await store.write(row.number, next);
  return kept.ok ? { done: true } : refused('record-failed');
};

/**
 * Writes the accepted `success` status on a HIGH whose ticket is recorded.
 *
 * No run, no agent: a bare commit status on the head, as the approval status
 * is. A host that cannot write one holds the PR and the tick says so.
 *
 * @param world - the tick's world.
 * @param opts - the repository and scripts directory.
 * @param row - the PR's row.
 * @param head - the head to write against.
 * @param exhausted - whether the attempts are spent.
 * @param ticket - the record read for this head.
 * @returns whether the status was written.
 */
const writeAccepted = async (
  world: TicketTickWorld,
  opts: ActOptions,
  row: PrIndexRow,
  head: string,
  exhausted: boolean,
  ticket: ReturnType<typeof ticketReading>,
): Promise<TicketActOutcome> => {
  const found = countsFor(world, opts, row.number, head);
  if ('why' in found) return refused(found.why);
  const earned = reviewStatus(found.counts, ticket, exhausted);
  if (earned.state !== 'success') return refused('status-not-earned');
  const written = await world.host(opts).commitStatus({
    sha: head,
    state: 'success',
    context: REVIEW_STATUS_CONTEXT,
    description: earned.description,
    targetUrl: row.url,
  });
  if (written.ok) return { done: true };
  if (written.why === 'unaskable') {
    world.notify(`plot-fleetd: PR #${row.number}: the host cannot write a commit status; the HIGH stays held`);
    return refused('host-unaskable');
  }
  return refused('status-failed');
};

const readAttempts = async (
  world: TicketTickWorld,
  opts: ActOptions,
  pr: number,
): Promise<FixerAttemptsRecord | 'none' | 'unreadable'> => {
  const asked = await world.attempts(opts).read(pr);
  return asked.ok ? asked.value : 'unreadable';
};

/**
 * One tick of the ticket arm over the open rows.
 *
 * For each row, reads the attempts and ticket records, asks {@link slicePrNext},
 * and acts on the one step it owns: `ticket` puts the head's findings on the
 * PR's ticket, and `write-status` with `ticket-accepted` writes the accepted
 * `success`. Every other step is returned and not acted on. A refusal is
 * logged once per PR, head and reason.
 *
 * @param rows - the open rows.
 * @param readings - the readings that do not depend on the row.
 * @param opts - the repository, scripts directory and run log.
 * @param world - the ports the tick acts through; the real adapters where absent.
 * @param logged - the refusals already logged; the caller keeps it across ticks.
 * @returns one result per row.
 */
export const ticketTick = async (
  rows: readonly PrIndexRow[],
  readings: TicketTickReadings,
  opts: ActOptions,
  world: TicketTickWorld = defaultTicketTickWorld,
  logged: Set<string> = new Set(),
): Promise<TicketTickResult[]> => {
  const results: TicketTickResult[] = [];
  for (const row of rows) {
    const attempts = await readAttempts(world, opts, row.number);
    const recorded = await world.tickets(opts).read(row.number);
    const record = recorded.ok ? recorded.value : 'unreadable';
    const head = row.headSha ?? '';
    const ticket = ticketReading(record, head);
    const step = slicePrNext({
      ...readings,
      row,
      desk: { dead: false, why: 'elsewhere' },
      fixer:
        attempts === 'unreadable'
          ? { read: 'unread' }
          : { read: 'record', inFlight: fixerInFlight(attempts), exhausted: fixerAttemptsExhausted(attempts) },
      ticket,
    });
    let acted: TicketActOutcome | undefined;
    if (step.step === 'ticket') {
      acted = await putOnTicket(world, opts, row, step.head, readings.now);
    } else if (step.step === 'write-status' && step.why === 'ticket-accepted') {
      acted = await writeAccepted(world, opts, row, step.head, attempts !== 'unreadable' && fixerAttemptsExhausted(attempts), ticket);
    }
    if (acted === undefined) {
      results.push({ pr: row.number, step });
      continue;
    }
    const key = `${row.number}:${head}:${acted.done ? 'done' : acted.why}`;
    if (!logged.has(key)) {
      logged.add(key);
      await runLogOf(opts).append({
        plan: '',
        branch: row.head,
        pr: String(row.number),
        head,
        step: step.step === 'ticket' ? 'ticket-open' : 'ticket-status',
        outcome: acted.done ? 'moved' : `failed: ${acted.why}`,
        at: new Date(readings.now).toISOString(),
      });
    }
    results.push({ pr: row.number, step, acted });
  }
  return results;
};

/**
 * Runs the ticket tick on the daemon's loop.
 *
 * @param opts - where the fleet acts.
 * @param logged - the refusals already logged, kept by the caller for the daemon's life.
 * @param now - epoch milliseconds.
 * @param world - the ports the tick acts through.
 * @param read - reads the rows and readings; {@link readFixerPass} by default.
 * @returns the tick's results, or `null` where nothing was read to act on.
 */
export const runAutoTicketPass = async (
  opts: ActOptions,
  logged: Set<string>,
  now: number = Date.now(),
  world: TicketTickWorld = defaultTicketTickWorld,
  read: (opts: ActOptions, now: number) => Promise<FixerPassReading | null> = readFixerPass,
): Promise<TicketTickResult[] | null> => {
  const reading = await read(opts, now);
  if (reading === null) return null;
  return ticketTick(reading.rows, reading.readings, opts, world, logged);
};

const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** The ports built from the real adapters. */
const defaultTicketTickWorld: TicketTickWorld = {
  attempts: (opts) => fixerAttemptsFile(opts.repoRoot),
  tickets: (opts) => ticketRecordFile(opts.repoRoot),
  tracker: async (opts) => {
    const context = { repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir };
    const [declared, backend] = await Promise.all([
      scriptsShell(context).config('Tracker', ''),
      hostShell(context).backend(),
    ]);
    return trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
  },
  host: (opts) => hostShell({ repoRoot: opts.repoRoot, scriptDir: opts.scriptsDir }),
  readVerdictFile: readOrNull,
  notify: (message) => console.error(message),
};
