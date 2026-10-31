import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import type { RepairRecord } from '@plot-pm/domain/entities/repair-record';
import { TICKET_RECORD_VERSION, type TicketRecord } from '@plot-pm/domain/entities/ticket-record';
import type { BuildPort } from '@plot-pm/domain/ports/build';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Containment, Refs } from '@plot-pm/domain/ports/refs';
import type { RepairRecordStore } from '@plot-pm/domain/ports/repair-record';
import type { Revert } from '@plot-pm/domain/ports/revert';
import type { TicketRecordStore } from '@plot-pm/domain/ports/ticket-record';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import { declaredRuns, foldRuns } from '@plot-pm/domain/rules/default-branch';
import {
  mergedRevertStep,
  prNumberOf,
  redMainPicker,
  redMainStep,
  type RedMainCandidate,
  type RedMainPickerAnswer,
} from '@plot-pm/domain/rules/repair';
import { rerunSettledOf } from '@plot-pm/domain/rules/repair-start';
import {
  REVERT_TICKET_LABEL,
  revertTicketBody,
  revertTicketHead,
  revertTicketTitle,
} from '@plot-pm/domain/rules/revert-ticket';
import { moveRepairState } from '@plot-pm/domain/transitions/repair-record';

/** What one revert pass did, for the log and the tests. */
export type RevertOutcome =
  | 'none'
  | 'held'
  | 'awaiting-rerun'
  | 'awaiting-revert'
  | 'rerun-asked'
  | 'claim-lost'
  | 'claim-failed'
  | 'revert-failed'
  | 'push-failed'
  | 'pr-failed'
  | 'revert-opened'
  | 'exhausted'
  | 'closed';

/** What one revert pass reads and acts through. */
export interface RevertWorld {
  /** The default-branch reading, or null where there is none. */
  reading(): Promise<DefaultBranchReading | null>;
  /** The repair record's file. */
  repair: RepairRecordStore;
  /** Ancestry of the breaking commit and the episode's red SHA, and the default branch's name. */
  refs: Pick<Refs, 'contains' | 'defaultBranch'>;
  /** The CI connector: a SHA's runs, and the re-run. */
  build: Pick<BuildPort, 'runsForSha' | 'rerunFailed'>;
  /** The host: PR lookup, PR creation and PR close. */
  host: Pick<Host, 'prState' | 'prCreate' | 'prClose'>;
  /** The revert git operation. */
  revert: Revert;
  /** One candidate commit with the readings the picker needs. */
  candidate(commit: { sha: string; subject: string }): Promise<RedMainCandidate>;
  /** The default branch's remote tip, the base of the claim commit; null where it could not be read. */
  baseSha(): Promise<string | null>;
  /** Pushes an empty claim commit for the branch without a checkout. */
  claim(branch: string, baseSha: string): Promise<'won' | 'lost' | 'failed'>;
  /** The desk's path where this machine holds one for the branch, else null. */
  deskOf(branch: string): Promise<string | null>;
  /** Creates the desk on the claimed branch; null where it could not. */
  makeDesk(branch: string): Promise<string | null>;
  /** Pushes the desk's branch. */
  push(desk: string, branch: string): Promise<boolean>;
  /** Whether the PR index reads the PR's `plot/review` status as a failure (a HIGH finding). */
  reviewFailed(pr: number): Promise<boolean>;
  /** Starts the review of a PR at a head; false where none started. */
  startReview(pr: number, head: string): Promise<boolean>;
  /** The ticket records, keyed by the reverted PR. */
  tickets: TicketRecordStore;
  /** The tracker that receives the revert ticket. */
  tracker: Pick<Tracker, 'issueOpen' | 'issueComment'>;
  /** Tells a person; failure is not retried. */
  notify(message: string): Promise<void>;
  /** Runs one host call, inside a host slot where the CI system is GitHub Actions. */
  slot<T>(call: () => Promise<T>): Promise<T>;
  /** Epoch ms. */
  now(): number;
  /** The `Checks wait` bound, in milliseconds. */
  checksWaitMs: number;
  /** The `Main repair bound`, in milliseconds. */
  mainRepairBoundMs: number;
  /** The workflow names `Default branch checks` declares. */
  checks: readonly string[];
}

/** Moves the record to `to` through the legal transitions; false where the move is refused. */
const moved = async (
  world: RevertWorld,
  record: RepairRecord,
  to: 'reverting' | 'done' | 'exhausted',
  patch: Partial<RepairRecord>,
): Promise<boolean> => {
  if (moveRepairState(record.state, to).outcome !== 'decided') return false;
  const written = await world.repair.write({ ...record, ...patch, state: to, at: new Date(world.now()).toISOString() });
  return written.ok;
};

const exhaust = async (world: RevertWorld, record: RepairRecord, why: string): Promise<RevertOutcome> => {
  if (!(await moved(world, record, 'exhausted', {}))) return 'held';
  await world.notify(`plot-fleetd: main repair exhausted — ${why}. Nothing more is tried for this episode.`);
  return 'exhausted';
};

/**
 * Takes the revert half of the repair arc for a red default branch.
 *
 * Reads the record and the reading, supplies `redMainStep` the picker's answer
 * and the last green SHA's re-run, and acts on three of its answers; the
 * re-run, the fix PR and the role belong to `repairStartTick`. A host answer
 * that did not come ends the pass with `held` and writes nothing.
 *
 * - `revert` with the record `repairing`: asks the last green SHA's re-run once
 *   and records `reverting` with `preRevertRerun: 'asked'`.
 * - `revert` with the record `reverting`: confirms the breaking commit is on
 *   the default branch and not yet reverted, re-reads the first red SHA's runs,
 *   claims `bug/revert-<pr>` before the revert commit is made, reverts, pushes,
 *   opens the revert PR, records it as `revertPr` and starts its review. Every
 *   step reads the world first, so a pass after a crash resumes at the step
 *   that did not finish. A conflicting revert ends the episode at `exhausted`.
 * - `close-prs`: closes each open PR the record names, writes the ticket for a
 *   merged revert, and records `done`. A reading without a settled commit, or
 *   an ancestry answer of `unknown`, closes nothing.
 * - `exhausted`: records it and notifies once.
 *
 * @param world - the reads and the actions.
 * @param warn - receives one line for each held pass.
 * @returns what the pass did.
 */
export const repairRevertTick = async (
  world: RevertWorld,
  warn: (line: string) => void = () => undefined,
): Promise<RevertOutcome> => {
  const reading = await world.reading();
  const read = await world.repair.read();
  if (!read.ok || read.value === null) return 'none';
  const record = read.value;
  if (record.state === 'done' || record.state === 'exhausted') return 'none';
  const now = world.now();

  let descends: Containment = 'yes';
  if (reading?.settled !== undefined && reading.settled.sha !== record.firstRedSha) {
    const asked = await world.refs.contains(record.firstRedSha, reading.settled.sha);
    descends = asked.ok ? asked.value : 'unknown';
  }

  const boundReached = now - Date.parse(record.redSince) >= world.mainRepairBoundMs;
  const inRevertWindow =
    boundReached &&
    (record.state === 'repairing' || record.state === 'reverting') &&
    reading?.settled !== undefined &&
    reading.headSha === reading.settled.sha;

  let pickerAnswer: RedMainPickerAnswer = 'unknown';
  if (inRevertWindow) pickerAnswer = redMainPicker(await Promise.all(record.candidates.map((c) => world.candidate(c))));

  let lastGreenRerunSettled: 'pending' | 'green' | 'red' | 'none' = 'none';
  if (record.state === 'reverting' && record.preRevertRerun === 'asked' && record.lastGreenSha !== undefined && reading !== null) {
    const lastGreen = record.lastGreenSha;
    const asked = await world.slot(() => world.build.runsForSha(reading.branch, lastGreen));
    lastGreenRerunSettled = rerunSettledOf(
      { ...record, rerun: record.preRevertRerun },
      asked.ok ? asked.value : null,
      world.checks,
      now,
    );
  }

  const step = redMainStep(reading, record, {
    now,
    checksWaitMs: world.checksWaitMs,
    mainRepairBoundMs: world.mainRepairBoundMs,
    descendsFromRecordedRed: descends,
    pickerAnswer,
    rerunSettled: 'none',
    repairInFlight: false,
    lastGreenRerunSettled,
  });

  if (step === 'exhausted' && record.revertPr !== undefined && lastGreenRerunSettled !== 'red') {
    return judgeRevertPr(world, reading, record, record.revertPr, warn);
  }

  if (step === 'exhausted') {
    const why = record.revertPr !== undefined ? 'the revert PR is already recorded' : lastGreenRerunSettled === 'red' ? 'the last green SHA reads red on a re-run' : 'no single breaking merge could be named';
    return exhaust(world, record, why);
  }

  if (step === 'close-prs') {
    if (reading?.settled === undefined || descends === 'unknown') {
      warn('plot-fleetd: revert held — no settled reading or no ancestry answer to close the episode on');
      return 'held';
    }
    return closePrs(world, record, warn);
  }

  if (step !== 'revert') return record.state === 'reverting' ? 'awaiting-rerun' : 'none';
  if (reading === null) return 'held';

  if (record.state === 'repairing') {
    if (record.lastGreenSha === undefined) return exhaust(world, record, 'the episode has no last green SHA to re-run');
    const lastGreen = record.lastGreenSha;
    const asked = await world.slot(() => world.build.rerunFailed(reading.branch, lastGreen));
    if (!asked.ok) {
      warn(`plot-fleetd: revert held — the re-run of ${lastGreen} was not accepted`);
      return 'held';
    }
    return (await moved(world, record, 'reverting', { preRevertRerun: 'asked' })) ? 'rerun-asked' : 'held';
  }

  if (pickerAnswer === 'unknown') return 'held';
  return makeRevert(world, record, reading, pickerAnswer.pr, warn);
};

/**
 * Decides what a recorded revert PR means while the default branch still reads
 * red: `redMainStep` answers `exhausted` for any recorded revert PR, and this
 * keeps the episode open while that PR is open, not red and not rejected by
 * its review, and while a merged revert has not yet settled on the default
 * branch (`mergedRevertStep`).
 */
const judgeRevertPr = async (
  world: RevertWorld,
  reading: DefaultBranchReading | null,
  record: RepairRecord,
  revertPr: number,
  warn: (line: string) => void,
): Promise<RevertOutcome> => {
  const looked = await world.slot(() => world.host.prState(revertPr));
  if (!looked.ok) {
    warn(`plot-fleetd: revert held — the host did not answer for PR #${revertPr}`);
    return 'held';
  }
  const pr = looked.value;
  if (pr === null) return 'held';
  if (pr.state === 'MERGED') {
    const settled = reading?.settled?.sha;
    let contains: Containment = 'unknown';
    if (settled !== undefined && pr.mergeCommit !== '' && settled !== pr.mergeCommit) {
      const asked = await world.refs.contains(pr.mergeCommit, settled);
      contains = asked.ok ? asked.value : 'unknown';
    }
    const merged = mergedRevertStep(reading, pr.mergeCommit, contains);
    if (merged === 'await-revert') return 'awaiting-revert';
    if (merged === 'hold') {
      warn(`plot-fleetd: revert held — the settled commit could not be read against the merge commit of revert PR #${revertPr}`);
      return 'held';
    }
    return exhaust(world, record, `the default branch still reads red after revert PR #${revertPr} merged`);
  }
  if (pr.state === 'CLOSED') return exhaust(world, record, `revert PR #${revertPr} was closed without merging`);
  if (pr.checks === 'failing') return exhaust(world, record, `revert PR #${revertPr} reads red`);
  if (await world.reviewFailed(revertPr)) return exhaust(world, record, `the review of revert PR #${revertPr} found a HIGH`);
  return 'awaiting-revert';
};

/** The `revert` step of a `reverting` record. */
const makeRevert = async (
  world: RevertWorld,
  record: RepairRecord,
  reading: DefaultBranchReading,
  revertedPr: number,
  warn: (line: string) => void,
): Promise<RevertOutcome> => {
  const breaking = record.candidates.find((c) => prNumberOf(c.subject) === revertedPr);
  const base = await world.refs.defaultBranch();
  if (breaking === undefined || !base.ok) return 'held';
  const ref = `origin/${base.value}`;
  const branch = `bug/revert-${revertedPr}`;

  const onMain = await world.refs.contains(breaking.sha, ref);
  const already = await world.revert.isReverted(breaking.sha, ref);
  if (!onMain.ok || onMain.value === 'unknown' || !already.ok) {
    warn(`plot-fleetd: revert held — ${breaking.sha} could not be read against ${ref}`);
    return 'held';
  }
  const existing = await world.slot(() => world.host.prState(branch));
  if (!existing.ok) {
    warn(`plot-fleetd: revert held — the host did not answer for '${branch}'`);
    return 'held';
  }
  const open = existing.value !== null && existing.value.state === 'OPEN' ? existing.value : null;

  if (open === null) {
    if (onMain.value === 'no') return exhaust(world, record, `${breaking.sha} is no longer on ${ref}`);
    if (already.value) return exhaust(world, record, `${breaking.sha} is already reverted on ${ref}`);
    const runs = await world.slot(() => world.build.runsForSha(reading.branch, record.firstRedSha));
    if (!runs.ok || foldRuns(declaredRuns(runs.value, world.checks)) !== 'red') {
      warn(`plot-fleetd: revert held — ${record.firstRedSha} does not read red on a second look`);
      return 'held';
    }
  }

  let desk = await world.deskOf(branch);
  if (desk === null && open === null) {
    const tip = await world.baseSha();
    if (tip === null) return 'held';
    const claimed = await world.claim(branch, tip);
    if (claimed === 'failed') return 'claim-failed';
    if (claimed === 'lost') return 'claim-lost';
    desk = await world.makeDesk(branch);
  }
  if (desk === null) return 'held';

  const done = await world.revert.isReverted(breaking.sha, branch);
  if (!done.ok) return 'held';
  if (!done.value) {
    const made = await world.revert.revertCommit(desk, breaking.sha);
    if (!made.ok) return 'revert-failed';
    if (made.value === 'conflict') return exhaust(world, record, `the revert of ${breaking.sha} conflicts with the default branch`);
  }
  if (!(await world.push(desk, branch))) return 'push-failed';

  let pr = open;
  if (pr === null) {
    const created = await world.host.prCreate({
      head: branch,
      base: base.value,
      title: `Revert PR #${revertedPr}: ${breaking.subject}`,
      body: `Reverts ${breaking.sha} (PR #${revertedPr}), the merge that turned ${reading.branch} red at ${record.firstRedSha}.`,
    });
    if (!created.ok) return 'pr-failed';
    const looked = await world.slot(() => world.host.prState(branch));
    pr = looked.ok ? looked.value : null;
  }
  if (pr === null) return 'pr-failed';

  await world.repair.write({ ...record, revertPr: pr.number, at: new Date(world.now()).toISOString() });
  if (pr.headSha !== undefined) await world.startReview(pr.number, pr.headSha);
  return 'revert-opened';
};

/** The `close-prs` step: closes the open PRs, writes the merged revert's ticket, records `done`. */
const closePrs = async (
  world: RevertWorld,
  record: RepairRecord,
  warn: (line: string) => void,
): Promise<RevertOutcome> => {
  let merged: { revertPr: number; revertedPr: number } | null = null;
  for (const number of [record.repairPr, record.revertPr]) {
    if (number === undefined) continue;
    const looked = await world.slot(() => world.host.prState(number));
    if (!looked.ok) {
      warn(`plot-fleetd: revert held — the host did not answer for PR #${number}`);
      return 'held';
    }
    const pr = looked.value;
    if (pr === null) continue;
    if (pr.state === 'MERGED' && number === record.revertPr) {
      const revertedPr = Number(/^bug\/revert-([1-9][0-9]*)$/.exec(pr.head)?.[1]);
      if (Number.isInteger(revertedPr)) merged = { revertPr: number, revertedPr };
    }
    if (pr.state !== 'OPEN') continue;
    const closed = await world.slot(() => world.host.prClose(number));
    if (!closed.ok) {
      warn(`plot-fleetd: revert held — PR #${number} could not be closed`);
      return 'held';
    }
  }
  if (merged !== null) await ticketMergedRevert(world, record, merged, warn);
  return (await moved(world, record, 'done', {})) ? 'closed' : 'held';
};

/**
 * Writes the ticket for a merged revert, keyed by the reverted PR.
 *
 * Reuses the ticket records and the tracker the HIGH-finding ticket writer
 * uses. A `pending` record is never retried: the open call may have landed.
 * A failure tells a person and does not hold the episode's close.
 */
const ticketMergedRevert = async (
  world: RevertWorld,
  record: RepairRecord,
  merged: { revertPr: number; revertedPr: number },
  warn: (line: string) => void,
): Promise<void> => {
  const reverted = await world.slot(() => world.host.prState(merged.revertedPr));
  const branch = reverted.ok && reverted.value !== null ? reverted.value.head : '';
  const body = revertTicketBody({
    revertedPr: merged.revertedPr,
    revertedBranch: branch,
    revertPr: merged.revertPr,
    firstRedSha: record.firstRedSha,
  });
  const head = revertTicketHead(merged.revertPr);
  const read = await world.tickets.read(merged.revertedPr);
  if (!read.ok || read.value === 'unreadable') {
    warn(`plot-fleetd: the ticket record for PR #${merged.revertedPr} could not be read`);
    return;
  }
  const existing = read.value;
  if (existing !== 'none' && existing.ticket === 'pending') {
    warn(`plot-fleetd: PR #${merged.revertedPr}: the ticket may exist; check its record`);
    return;
  }
  if (existing !== 'none') {
    if (existing.heads.includes(head)) return;
    const commented = await world.tracker.issueComment(existing.id, body);
    if (commented.ok) {
      const next: TicketRecord = { ...existing, heads: [...existing.heads, head] };
      await world.tickets.write(merged.revertedPr, next);
    } else warn(`plot-fleetd: the revert ticket comment for PR #${merged.revertedPr} was not written`);
    return;
  }
  const marked = await world.tickets.write(merged.revertedPr, {
    v: TICKET_RECORD_VERSION,
    pr: merged.revertedPr,
    ticket: 'pending',
    at: new Date(world.now()).toISOString(),
  });
  if (!marked.ok) return;
  const opened = await world.tracker.issueOpen({
    title: revertTicketTitle(merged.revertedPr),
    body,
    labels: [REVERT_TICKET_LABEL],
  });
  if (!opened.ok) {
    warn(`plot-fleetd: the revert ticket for PR #${merged.revertedPr} was not opened`);
    if (opened.why === 'unaskable') await world.tickets.clear(merged.revertedPr);
    return;
  }
  await world.tickets.write(merged.revertedPr, {
    v: TICKET_RECORD_VERSION,
    pr: merged.revertedPr,
    ticket: 'opened',
    id: opened.value.id,
    heads: [head],
  });
};
