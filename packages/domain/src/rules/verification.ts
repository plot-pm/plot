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

/** Where a refuted claim's issue stands: opened as `issue`, or not opened for `noIssue`. */
export type IssueNote = { readonly issue: string } | { readonly noIssue: string };

/**
 * Renders the issue reference that ends a refuted claim's line.
 *
 * A numeric id renders as `#<id>` and any other id, such as the Jira key
 * `PROJ-12`, renders bare; `refutedClaims` reads both back. The reason is the
 * port's text with every run of whitespace collapsed to one space and every
 * ` — ` written as ` - `, so the line stays one line and its ` — ` columns
 * still separate.
 *
 * @param note - what came of the claim's issue.
 * @returns `#<id>`, `<id>`, or `no issue: <reason>`.
 */
export const issueReference = (note: IssueNote): string => {
  if ('issue' in note) return /^\d+$/.test(note.issue) ? `#${note.issue}` : note.issue;
  return `no issue: ${note.noIssue.replace(/\s+/g, ' ').replace(/ — /g, ' - ').trim()}`;
};

/**
 * The title and body of the issue a refuted claim opens.
 *
 * @param slug - the plan's slug.
 * @param verdict - the refuted claim.
 * @param judged - the commit the claim was judged at.
 * @returns the issue's title and body.
 */
export const refutedIssue = (
  slug: string,
  verdict: ClaimVerdict,
  judged: string,
): { readonly title: string; readonly body: string } => {
  const claim = verdict.claim.length > 80 ? `${verdict.claim.slice(0, 79)}…` : verdict.claim;
  const supported = verdict.supported.length > 0 ? `; ${verdict.supported.join(', ')} supported` : '';
  return {
    title: `Refuted claim of ${slug}: ${claim}`,
    body: `Verification of \`${slug}\` at ${short(judged)} refuted ${claimLabel(verdict.n)}.\n\n> ${verdict.claim}\n\nRefuted by ${verdict.refuted.join(', ')}${supported}.\n`,
  };
};

/**
 * Renders the body of the plan's `## Verification` section.
 *
 * @param verdicts - what the fold answered.
 * @param notes - the issue note per refuted claim text; a claim with none ends at its lenses.
 * @returns one list line per claim, each ending in a newline.
 */
export const verificationBody = (
  verdicts: readonly ClaimVerdict[],
  notes: ReadonlyMap<string, IssueNote> = new Map(),
): string =>
  verdicts
    .map((v) => {
      const lenses =
        v.verdict === 'supported'
          ? `${v.supported.length} of ${v.supported.length} (${v.supported.join(', ')})`
          : `${v.refuted.join(', ')} refuted${v.supported.length > 0 ? `; ${v.supported.join(', ')} supported` : ''}`;
      const note = v.verdict === 'refuted' ? notes.get(v.claim) : undefined;
      return `- ${claimLabel(v.n)} ${v.verdict} — ${v.claim} — ${lenses}${note === undefined ? '' : ` — ${issueReference(note)}`}\n`;
    })
    .join('');
