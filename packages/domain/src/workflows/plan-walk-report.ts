import type { AssembledBranch, AssembledPlan, Assembly, FleetReadingHeader } from './plan-walk-assembly.js';

/**
 * The prose report `plot-fleet-scan.sh --log-pulse` prints: a banner, one block
 * per plan, the notes that qualify the reading, the delta, and the footer.
 */

/** The summary key the shell's `summary:` line spells for the slice count. */
const SLICE_COUNT_KEY = 'waves';

/** What the banner and the notes need beyond the {@link FleetReadingHeader}. */
export interface ReportContext {
  /** How many commits `origin/<main>` holds that the checkout lacks; `null` where git could not count. */
  behind: number | null;
  /** Whether the scan was asked for `--loose`. */
  loose: boolean;
  /** Whether `--loose` could verify PR readiness (a host was asked). */
  looseVerifiable: boolean;
  /** Whether the fetch was skipped (`--offline`). */
  offline: boolean;
  /** Where the estate read its plans. */
  planSource: 'ref' | 'worktree';
  /** The `subject_predates_plan` count the footer carries. */
  subjectPredatesPlan: number;
}

/**
 * The first line of the report, with the blank line after it.
 *
 * @param header - the checkout's facts.
 * @param context - the behind count and the `--loose` words.
 * @returns the banner and a blank line.
 */
export const reportBanner = (header: FleetReadingHeader, context: ReportContext): string => {
  let banner = `plot-fleet pulse — ${header.readRef} on origin/${header.main}`;
  if (header.readRef !== 'unknown' && header.localHead !== header.readRef) {
    banner +=
      context.behind !== null && context.behind !== 0
        ? ` (not your checkout ${header.localHead}, ${context.behind} behind)`
        : ` (not your checkout ${header.localHead})`;
  }
  if (context.loose) {
    banner += context.looseVerifiable
      ? ' (loose eligibility)'
      : ' (--loose cannot verify PR readiness without a git host — using strict)';
  }
  return `${banner}\n\n`;
};

/**
 * The note after a branch's name.
 *
 * @param branch - the assembled branch.
 * @param hostWord - the summary's host word.
 * @returns the sentence.
 */
const branchNote = (branch: AssembledBranch, hostWord: string): string => {
  const waits = branch.waitsOn.join(', ');
  switch (branch.state) {
    case 'waiting':
      return `waiting on ${waits}`;
    case 'blocked':
      return `blocked — no PR found for ${waits}`;
    case 'deferred':
      return `deferred${branch.deferredReason === '' ? '' : ` — ${branch.deferredReason}`}`;
    case 'claimed':
      return `claimed${branch.claimed === '' ? '' : ` (${branch.claimed})`}`;
    case 'merged':
      return 'merged';
    case 'wip':
      return 'in progress';
    case 'unknown':
      return `unknown — PR could not be read (${hostWord} host)`;
    default:
      return 'open';
  }
};

/**
 * One plan's block: its heading, each slice's verdict line and branch lines, and a blank line.
 *
 * @param plan - the assembled plan.
 * @param header - the checkout's facts; `planDir` and `host` are read.
 * @param loose - whether the scan was asked for `--loose`, which prints the degraded note.
 * @returns the block, ending in a blank line.
 */
export const planReport = (plan: AssembledPlan, header: FleetReadingHeader, loose: boolean): string => {
  const file = plan.file.startsWith(header.planDir) ? plan.file.slice(header.planDir.length) : plan.file;
  if (plan.slices.every((slice) => slice.branches.length === 0)) return `== ${file} ==\n  (no branches)\n\n`;
  const blocks = plan.slices.map((slice) => {
    if (slice.branches.length === 0) return '';
    const someoneOnIt = slice.verdict === 'eligible' && slice.free === 0 && slice.taken > 0;
    const head = `  ${slice.name === '' ? '(unnamed)' : slice.name} — ${slice.verdict}${someoneOnIt ? ' — someone-is-on-it' : ''}\n`;
    const degraded =
      loose && slice.looseDegraded.length > 0
        ? `      (--loose degraded to strict: checks unavailable for ${slice.looseDegraded.join(' ')})\n`
        : '';
    const lines = slice.branches.map((b) => `      ${b.branch} — ${branchNote(b, header.host)}\n`).join('');
    return `${head}${degraded}${lines}`;
  });
  return `== ${file} ==\n${blocks.join('')}\n`;
};

/**
 * The notes that qualify the reading, after the last plan.
 *
 * @param header - the checkout's facts.
 * @param context - the offline and plan-source words.
 * @returns the notes, `''` where none applies.
 */
export const reportNotes = (header: FleetReadingHeader, context: ReportContext): string => {
  let out = '';
  if (header.fetchFailed) {
    out +=
      '  note: git fetch failed — these refs are as current as your last\n' +
      `        successful fetch, not as current as origin/${header.main}.\n` +
      `        ${header.fetchError}\n` +
      '        Stale remote-tracking refs were not pruned either, so a branch\n' +
      '        merged and deleted upstream may still read wip.\n';
  }
  if (context.offline) {
    out +=
      '  note: --offline skipped the fetch, so stale remote-tracking refs were\n' +
      '        not pruned; a branch merged and deleted upstream may read wip\n' +
      '        and hold its wave blocked. Re-run without --offline to settle it.\n';
  }
  if (context.planSource !== 'ref') {
    out +=
      `  note: origin/${header.main} could not be read — plans were listed from this\n` +
      '        checkout instead, so the list is only as current as your last pull.\n';
  }
  return out;
};

/**
 * The last two lines of the report.
 *
 * @param assembly - the assembly.
 * @param header - the checkout's facts.
 * @param context - the `subject_predates_plan` count.
 * @returns `Pulse complete.` and the `summary:` line.
 */
export const reportFooter = (assembly: Assembly, header: FleetReadingHeader, context: ReportContext): string => {
  const s = assembly.summary;
  const done = 'Pulse complete. This report is derived — nothing was changed.\n';
  if (s.plans === 0) {
    return `${done}summary: plans=0 ${SLICE_COUNT_KEY}=0 branches=0 claimed=0 claimable=0 eligible=0 blocked=0 deferred=0 waiting=0 prereq_missing=0 main=${header.main}\n`;
  }
  return `${done}summary: plans=${s.plans} ${SLICE_COUNT_KEY}=${s.sliceCount} branches=${s.branches} claimed=${s.claimed} claimable=${s.eligible} eligible=${s.eligible} blocked=${s.blocked} deferred=${s.deferred} waiting=${s.waiting} prereq_missing=${s.prereqMissing} merge_detect=${header.mergeDetect} subject_predates_plan=${context.subjectPredatesPlan} host=${header.host} main=${header.main}\n`;
};
