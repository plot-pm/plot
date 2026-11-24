import {
  RELEASE_NOTIFIED_STEP,
  RELEASE_REVIEW_STEP,
  encodeNotifyOutcome,
  releasePrepareNext,
  releaseStage,
  REVIEW_START_BUDGET,
  releaseUnbooked,
  releaseUnbookedDiff,
  type Finding,
  type MonitorName,
  type ReleaseUnbookedAnswer,
  type ReleaseUnbookedReadings,
  type ReleaseChangeset,
  type ReleaseChecksReading,
  type ReleaseFinishReading,
  type ReleaseHeadReading,
  type ReleasePrReading,
  type ReleasePrepareConfig,
  type ReleasePrepareStep,
  type ReleaseStage,
  type RunLog,
  type RunLogLine,
  type SprintScope,
} from '@plot-pm/domain';
import {
  liveReviewRuns,
  readReviewStarts,
  startReview,
  type StartReviewOptions,
  type StartReviewResult,
} from '@plot-pm/domain/adapters/review-start/review-start-node';
import type { Notifier } from '@plot-pm/domain/ports/notifier';

/** The readings and writes one release tick goes through. Each read answers `unaskable` where it failed. */
export interface ReleaseTickPorts {
  readonly scope: () => Promise<SprintScope>;
  /** Each scoped plan's phase, lowercase, keyed by plan slug. */
  readonly phases: () => Promise<ReadonlyMap<string, string> | 'unaskable'>;
  /** The release PR's row from the index, or the host's answer; never `none` from an index miss. */
  readonly pr: () => Promise<ReleasePrReading>;
  readonly runs: (branch: string, sha: string) => Promise<ReleaseChecksReading>;
  /** What the head's `sha` changes against its merge base; `null` where the host has no release workflows. */
  readonly headChanges: (sha: string) => Promise<ReleaseHeadReading | null>;
  readonly changesets: () => Promise<readonly ReleaseChangeset[] | 'unaskable'>;
  readonly finish: () => Promise<ReleaseFinishReading>;
  /** What `releaseUnbooked` reads: the newest release tag, the sprints, the plans and the tag's changesets. */
  readonly unbooked: () => Promise<ReleaseUnbookedReadings>;
  readonly log: RunLog;
  readonly notifier: Notifier;
  /** The channel the `release unbooked` finding goes to; absent where no channel runs. */
  readonly channel?: ReleaseChannel | null;
  /** Receives one line per publish or retraction on the channel. */
  readonly say?: (line: string) => void;
}

/** The part of the running channel the release tick writes to. */
export interface ReleaseChannel {
  findings(): readonly Finding[];
  publish(finding: Finding): void;
  seen(monitor: MonitorName): void;
}

/** The run-log outcome of a `review` step that `Auto-review` off kept from starting. */
export const REVIEW_SKIPPED_AUTO_REVIEW_OFF = 'skipped: auto-review-off';

/** What one release tick did. */
export interface ReleaseTickResult {
  readonly stage: ReleaseStage;
  readonly step: ReleasePrepareStep;
  /** Set where the step was `review` and a start was tried. */
  readonly started?: StartReviewResult;
  /** Set where the step was `review` and `reviewEnabled` was false: the outcome the run log recorded. */
  readonly skipped?: typeof REVIEW_SKIPPED_AUTO_REVIEW_OFF;
  /** Set where the step was `notify`: the send status the run log recorded. */
  readonly notified?: string;
  /** What the newest release still owes, as `releaseUnbooked` answered it this tick. */
  readonly unbooked?: ReleaseUnbookedAnswer;
}

/**
 * One tick of the release arm.
 *
 * Reads the scope, phases, release PR, required workflow runs, changesets and
 * run log fresh, asks {@link releasePrepareNext}, and acts on the step: a
 * `review` step goes through `startReview` — the only start that writes the
 * `plot/review` status — or, with `reviewEnabled` false, appends a
 * `skipped: auto-review-off` line and starts nothing; a `notify` step sends one
 * message through the `Notifier`. Each action appends one run-log line recording what fleetd did;
 * no line records readiness. fleetd never merges and never books a plan.
 *
 * Each tick also asks `releaseUnbooked` and brings the channel's
 * `release unbooked` finding in line with the answer through
 * `releaseUnbookedDiff`. It persists nothing and books nothing.
 *
 * @param ports - the readings and writes.
 * @param config - the rule's constants.
 * @param start - the review start's paths, ports and bounds, without the mode.
 * @param now - epoch milliseconds of the tick.
 * @param reviewEnabled - whether a `review` step may start an agent; the notice is sent either way.
 * @returns the stage, the step and what the action came to.
 */
export const releaseTick = async (
  ports: ReleaseTickPorts,
  config: ReleasePrepareConfig,
  start: Omit<StartReviewOptions, 'mode' | 'now'>,
  now: number,
  reviewEnabled = true,
): Promise<ReleaseTickResult> => {
  const [scope, phases, pr, changesets, finish, logRead, unbookedRead] = await Promise.all([
    ports.scope(),
    ports.phases(),
    ports.pr(),
    ports.changesets(),
    ports.finish(),
    ports.log.read(),
    ports.unbooked(),
  ]);
  const unbooked = releaseUnbooked(unbookedRead);
  publishUnbooked(ports, unbooked, new Date(now).toISOString());
  const log = logRead.ok ? logRead.value : ('unaskable' as const);
  const row = pr === 'none' || pr === 'unaskable' ? null : pr;
  const checks: ReleaseChecksReading =
    row?.headSha === undefined ? { read: 'unaskable' } : await ports.runs(row.head, row.headSha);
  const headChanges = row?.headSha === undefined ? ('unaskable' as const) : await ports.headChanges(row.headSha);
  const live = liveReviewRuns(start.repoRoot, start.pidAlive, now);
  const run = row === null ? null : (live?.find((entry) => entry.pr === row.number) ?? null);
  const starts = row === null ? null : (readReviewStarts(start.repoRoot)?.find((entry) => entry.pr === row.number) ?? null);
  const readings = {
    scope,
    phases,
    pr,
    checks,
    headChanges,
    changesets,
    log,
    reviewRun: run === null ? null : { head: run.head, pid: run.pid, startedAt: run.startedAt, live: true },
    reviewStarts: starts,
    finish,
    config: { ...config, startBudget: config.startBudget || REVIEW_START_BUDGET },
    now,
  };
  const stage = releaseStage(readings);
  const step = releasePrepareNext(readings);
  if (row === null || scope.read !== 'scope') return { stage, step, unbooked };
  const at = new Date(now).toISOString();
  const line = (kind: RunLogLine['step'], head: string, outcome: string): RunLogLine => ({
    plan: scope.sprint.slug,
    branch: row.head,
    pr: String(row.number),
    head,
    step: kind,
    outcome,
    at,
  });

  if (step.step === 'review' && reviewEnabled) {
    const started = startReview(row.number, step.head, { ...start, mode: 'review', now });
    await ports.log.append(line(RELEASE_REVIEW_STEP, step.head, started.started ? 'moved' : `failed: ${started.why}`));
    return { stage, step, started, unbooked };
  }
  if (step.step === 'review') {
    await ports.log.append(line(RELEASE_REVIEW_STEP, step.head, REVIEW_SKIPPED_AUTO_REVIEW_OFF));
    return { stage, step, skipped: REVIEW_SKIPPED_AUTO_REVIEW_OFF, unbooked };
  }
  if (step.step === 'notify' && changesets !== 'unaskable') {
    const sent = await ports.notifier.notify(releaseMessage(row.number, step, scope.sprint.slug));
    const status = sent.ok ? 'sent' : sent.why === 'unaskable' ? 'unaskable' : `failed ${sent.code}`;
    const files = changesets.map((c) => c.file);
    await ports.log.append(line(RELEASE_NOTIFIED_STEP, step.head, encodeNotifyOutcome(status, files)));
    return { stage, step, notified: status, unbooked };
  }
  return { stage, step, unbooked };
};

/**
 * Publishes and retracts the `release unbooked` finding for one answer.
 *
 * Marks the `ReleaseMonitor` seen unless the answer is `unaskable`.
 *
 * @param ports - the channel and the line sink.
 * @param answer - the rule's answer.
 * @param at - the tick's time, ISO-8601.
 */
const publishUnbooked = (ports: ReleaseTickPorts, answer: ReleaseUnbookedAnswer, at: string): void => {
  const channel = ports.channel;
  if (channel === undefined || channel === null) return;
  const { publish, clear } = releaseUnbookedDiff(channel.findings(), answer, at);
  for (const f of [...clear, ...publish]) {
    channel.publish(f);
    ports.say?.(`plot-fleetd: release ${f.finding === 'clear' ? 'clear' : 'publish'} ${f.monitor} ${f.branch}: ${f.evidence}`);
  }
  if (answer !== 'unaskable') channel.seen('ReleaseMonitor');
};

/**
 * The notification text: the PR, the head and the two changeset groups.
 *
 * @param pr - the release PR number.
 * @param step - the `notify` step.
 * @param sprint - the sprint's slug.
 * @returns the message.
 */
export const releaseMessage = (
  pr: number,
  step: Extract<ReleasePrepareStep, { step: 'notify' }>,
  sprint: string,
): string => {
  const list = (files: readonly string[]): string => (files.length === 0 ? 'none' : files.join(', '));
  return [
    `Release PR #${pr} can be approved at ${step.head.slice(0, 7)}${step.first ? '' : ' (changesets changed)'}.`,
    `Sprint ${sprint}: ${list(step.changesets.scope)}.`,
    `Outside work: ${list(step.changesets.outside)}.`,
  ].join('\n');
};


/**
 * The fleetd stdout line for one release tick.
 *
 * @param outcome - what the tick did.
 * @returns the line without its newline, or `null` where the step was `none`.
 */
export const releaseLine = (outcome: ReleaseTickResult): string | null => {
  if (outcome.skipped !== undefined) return `plot-fleetd: release ${outcome.stage}: review skipped (Auto-review off)`;
  return outcome.step.step === 'none' ? null : `plot-fleetd: release ${outcome.stage}: ${outcome.step.step}`;
};
