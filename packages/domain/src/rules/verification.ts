import { claimLabel } from './claims.js';
import { readJuror } from './panel.js';

/** The words a verification juror may commit to, per claim. */
export const VERIFY_POSITIONS = ['supported', 'refuted'] as const;

/** One juror's file, as read from disk. */
export interface JurorFile {
  /** The persona that wrote the file. */
  readonly lens: string;
  /** The file's contents, or `null` when it does not exist. */
  readonly text: string | null;
}

/** The fold's answer for one claim. */
export interface ClaimVerdict {
  /** The claim's 1-based number. */
  readonly n: number;
  /** The claim's text. */
  readonly claim: string;
  /** `supported` when no juror refuted it. */
  readonly verdict: 'supported' | 'refuted';
  /** The lenses that committed `supported`. */
  readonly supported: readonly string[];
  /** The lenses that committed `refuted`. */
  readonly refuted: readonly string[];
}

/** One juror file the gate refused for one claim. */
export interface ClaimRefusal {
  /** The label the juror had to commit on, such as `Claim-2`. */
  readonly label: string;
  /** The juror whose file was refused. */
  readonly lens: string;
  /** Why `readJuror` refused it. */
  readonly why: string;
}

/** What {@link foldVerification} answers: a record, or the refusals that block one. */
export type Fold =
  | { readonly fold: 'record'; readonly verdicts: readonly ClaimVerdict[] }
  | { readonly fold: 'refused'; readonly refusals: readonly ClaimRefusal[] };

/**
 * Folds every juror's committed lines into one verdict per claim.
 *
 * Each juror file is read once per claim label through `readJuror`, so every
 * verdict traces to a gated line and never to the moderator's prose.
 * A claim is `refuted` when one or more jurors committed `refuted`: one
 * refutation decides. It is `supported` when every juror committed
 * `supported`. When any juror's file is refused for any claim, the fold
 * answers `refused` with every refusal and no verdict, because a record
 * built from an incomplete reading looks complete.
 *
 * @param claims - what `claimsOf` answered; claim `n` is `claims[n - 1]`.
 * @param jurors - one entry per juror.
 * @returns the verdicts, or the refusals.
 */
export const foldVerification = (
  claims: readonly string[],
  jurors: readonly JurorFile[],
): Fold => {
  if (jurors.length === 0) {
    return { fold: 'refused', refusals: [{ label: claimLabel(1), lens: '', why: 'no juror wrote a file' }] };
  }
  const verdicts: ClaimVerdict[] = [];
  const refusals: ClaimRefusal[] = [];
  claims.forEach((claim, i) => {
    const n = i + 1;
    const supported: string[] = [];
    const refuted: string[] = [];
    for (const juror of jurors) {
      const reading = readJuror(juror.lens, juror.text, {
        label: claimLabel(n),
        positions: VERIFY_POSITIONS,
      });
      if (reading.read !== 'committed') {
        refusals.push({ label: claimLabel(n), lens: juror.lens, why: reading.why });
      } else if (reading.position === 'supported') supported.push(juror.lens);
      else refuted.push(juror.lens);
    }
    verdicts.push({ n, claim, verdict: refuted.length > 0 ? 'refuted' : 'supported', supported, refuted });
  });
  return refusals.length > 0 ? { fold: 'refused', refusals } : { fold: 'record', verdicts };
};

/** The commits and dates a record names. */
export interface VerificationFacts {
  /** The date of the run, `YYYY-MM-DD`. */
  readonly today: string;
  /** The plan's own `Delivered:` date. */
  readonly deliveredOn: string;
  /** The commit that added the `Delivered:` line. */
  readonly delivery: string;
  /** The commit the claims were judged at. */
  readonly judged: string;
  /** The commit the run's tools came from. */
  readonly tools: string;
}

/** The seven-character form of a commit name. */
const short = (sha: string): string => sha.slice(0, 7);

/**
 * Renders the value of the plan's `Verified:` record.
 *
 * @param facts - the dates and commits to name.
 * @param verdicts - what the fold answered.
 * @returns the value without its `- **Verified:** ` prefix.
 */
export const verifiedValue = (
  facts: VerificationFacts,
  verdicts: readonly ClaimVerdict[],
): string => {
  const refuted = verdicts.filter((v) => v.verdict === 'refuted').length;
  return `${facts.today}, delivery ${facts.deliveredOn} at ${short(facts.delivery)}, judged at ${short(facts.judged)} with tools at ${short(facts.tools)}, ${verdicts.length - refuted} supported, ${refuted} refuted`;
};

/**
 * Renders the body of the plan's `## Verification` section.
 *
 * @param verdicts - what the fold answered.
 * @returns one list line per claim, each ending in a newline.
 */
export const verificationBody = (verdicts: readonly ClaimVerdict[]): string =>
  verdicts
    .map((v) => {
      const lenses =
        v.verdict === 'supported'
          ? `${v.supported.length} of ${v.supported.length} (${v.supported.join(', ')})`
          : `${v.refuted.join(', ')} refuted${v.supported.length > 0 ? `; ${v.supported.join(', ')} supported` : ''}`;
      return `- ${claimLabel(v.n)} ${v.verdict} — ${v.claim} — ${lenses}\n`;
    })
    .join('');
