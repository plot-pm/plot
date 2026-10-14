import { type Outcome, type Write, decide, refuse } from './decision.js';
import { isRefusal, needsDesign, type NeedsDesignInput, type PlanState } from '../transitions/plan.js';

/** The placeholder an empty `## Spec` section carries. */
export const SPEC_PLACEHOLDER = '_To be filled in during Design._';

/**
 * The body of a plan's `## Spec` section outside fences, or `''` where it has
 * none.
 *
 * @param text - the plan's full text.
 * @returns the section body, trimmed.
 */
export const specOf = (text: string): string => {
  const lines = text.split('\n');
  let fenced = false;
  let start = -1;
  const body: string[] = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) {
      if (start !== -1) body.push(line);
      continue;
    }
    if (start === -1) {
      if (line.trimEnd() === '## Spec') start = 1;
    } else if (/^#{1,2} /.test(line)) break;
    else body.push(line);
  }
  return body.join('\n').trim();
};

/** Why `planNeedsDesign` refused. */
export type NeedsDesignRefusal =
  | 'plan-not-found'
  | 'plan-unparseable'
  | 'state-terminal'
  | 'state-unreadable'
  | 'state-wrong'
  | 'review-human'
  | 'review-unrecognised'
  | 'plan-pr-absent';

/** What the host answered about the plan PR. */
export interface NeedsDesignPrReading {
  /** The PR's number; 0 where the host holds none. */
  number: number;
  /** The state as the host reports it. */
  state: 'MERGED' | 'OPEN' | 'CLOSED' | 'NONE';
  /** The PR's head branch, or `''` where the host holds no PR. */
  head: string;
}

/** What `planNeedsDesign` reads about the plan it would move. */
export interface NeedsDesignReadings {
  /** The plan's slug. */
  slug: string;
  /** The plan file's path, or `''` when no plan was found for the slug. */
  file: string;
  /** Whether the parser could read the file at all. */
  parsed: boolean;
  /** The phase, normalized; `''` or `NONE` where the file stated none. */
  phase: string;
  /** The declared review channel; `NONE` for a plan that recorded no answer. */
  review: string;
  /** The declared implementation home, normalized. */
  impl: string;
  /** The body of the plan's `## Spec` section, or `''` where it has none or an empty one. */
  spec: string;
  /** What the host says about the plan PR. */
  pr: NeedsDesignPrReading;
}

/** Where a Design move writes. */
export type NeedsDesignTarget = 'plan-pr' | 'caller-checkout' | 'booking';

/** What a Design move decided, beyond its writes. */
export interface NeedsDesignDetail {
  /** The plan moved. */
  slug: string;
  /** Where the write lands. */
  target: NeedsDesignTarget;
  /** The branch the commit lands on; `''` for the caller's checkout. */
  branch: string;
  /** The plan PR the write rides on; 0 where there is none. */
  pr: number;
}

/**
 * Decides what moving a Draft plan into Design would write, and where.
 *
 * The plan's state and the person are decided by the `needsDesign` transition.
 * The write target follows from the declared implementation home and review
 * channel:
 *
 * - `Impl: same branch` writes in the caller's checkout and pushes nothing.
 * - `Review: pr` (or no recorded answer) with an open plan PR commits onto the
 *   PR's head branch and pushes that branch.
 * - `Review: pr` with no open plan PR refuses `plan-pr-absent`, naming the
 *   PR's state.
 * - `Review: in-session` and `Review: ballot` commit on the booking branch
 *   `plot/needs-design-<slug>`, cut from the default branch.
 *
 * An existing non-empty `## Spec` section is left unchanged.
 *
 * @param readings - what the adapters measured about the plan and its PR.
 * @param input - the date, person and channel to record.
 * @returns a decision naming every write, or a refusal naming the rule that
 *   fired: `plan-not-found`, `plan-unparseable`, `state-terminal`,
 *   `state-unreadable`, `state-wrong`, `review-human`, `review-unrecognised`
 *   or `plan-pr-absent`.
 */
export const planNeedsDesign = (
  readings: NeedsDesignReadings,
  input: NeedsDesignInput,
): Outcome<NeedsDesignDetail, NeedsDesignRefusal> => {
  const { slug, file } = readings;
  const no = (reason: NeedsDesignRefusal, detail: string) => refuse('needs-design', reason, detail);

  if (file === '') return no('plan-not-found', `no plan found for '${slug}'.`);
  if (!readings.parsed) {
    return no('plan-unparseable', `cannot parse '${file}' — refusing rather than guessing.`);
  }

  const phase = (readings.phase === '' || readings.phase === 'NONE' ? 'none' : readings.phase) as PlanState;
  const verdict = needsDesign(
    { slug, phase, review: readings.review, approvedRecord: '', deliveredRecord: '', releasedRecord: '' },
    input,
  );
  if (isRefusal(verdict)) {
    return no(verdict.reason as NeedsDesignRefusal, verdict.detail);
  }

  const sameBranch = readings.impl === 'same-branch';
  let target: NeedsDesignTarget;
  let branch = '';
  switch (readings.review) {
    case 'in-session':
    case 'ballot':
      target = sameBranch ? 'caller-checkout' : 'booking';
      branch = sameBranch ? '' : `plot/needs-design-${slug}`;
      break;
    case 'pr':
    case 'NONE':
    case '':
      if (sameBranch) {
        target = 'caller-checkout';
        break;
      }
      if (readings.pr.state !== 'OPEN') {
        return no(
          'plan-pr-absent',
          readings.pr.state === 'NONE'
            ? `plan '${slug}' declares 'Review: pr' and has no plan PR — open one before moving it to Design.`
            : `plan '${slug}' declares 'Review: pr' and its plan PR #${readings.pr.number} is ${readings.pr.state.toLowerCase()}, not open — refusing rather than writing Design onto the default branch.`,
        );
      }
      target = 'plan-pr';
      branch = readings.pr.head;
      break;
    default:
      return no(
        'review-unrecognised',
        `plan '${slug}' records an unrecognised 'Review:' answer ('${readings.review}'). Refusing rather than treating it as 'pr'.`,
      );
  }

  const writes: Write[] = [
    { kind: 'plan-phase', file, phase: 'Design' },
    { kind: 'plan-record', file, field: 'Design', value: verdict.record },
  ];
  if (readings.spec.trim() === '') {
    writes.push({ kind: 'plan-section', file, heading: 'Spec', body: SPEC_PLACEHOLDER });
  }
  writes.push({ kind: 'commit', message: `plot: move ${slug} to design`, paths: [file] });
  if (target !== 'caller-checkout') {
    writes.push({ kind: 'push', branch, onto: target === 'booking' ? 'default' : '' });
  }

  return decide('needs-design', writes, {
    slug,
    target,
    branch,
    pr: target === 'plan-pr' ? readings.pr.number : 0,
  });
};
