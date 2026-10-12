/**
 * The panel's mechanical half: where a juror writes, and whether what it wrote
 * is a position or a hedge.
 *
 * **`panel`, `juror` — never `verdict`.** `rules/verdict.ts` is a slice's wave
 * eligibility (`complete`/`empty`/`unapproved`/`eligible`/`blocked`), shipped as
 * `plot-verdicts.mjs` and rendered by the board. The word is taken and it means
 * something else, so a reader arriving at a `verdict` identifier in this estate
 * must keep finding eligibility. The plan's prose says "verdict file"; the
 * identifiers say juror.
 *
 * **The lens is not here.** Which persona reads the plan, what it asks and how
 * the moderator reconciles four answers are judgement, and judgement lives in
 * skill prose (Manifesto Principle 3). What is mechanical is the check that a
 * file contains its committed line — and that is the whole of this module.
 */

/**
 * The directory a panel's juror files go in, relative to the repo root.
 *
 * **Tracked, not machine-local.** `.gitignore:30` ignores `.plot/state/` and
 * tracks the rest of `.plot/`, so this path decides whether a panel's reasoning
 * survives its worktree. A desk is transient and `plot-reap.sh` removes it, so
 * verdicts written under `.plot/state/` die with the checkout — which is the
 * failure this repo has already measured and recorded: an observation that
 * exists only in one agent's context dies with it.
 *
 * The plan parks the choice as an Open Question. This is the answer, stated
 * rather than arrived at by picking a path: a panel's files are an artifact a
 * person reads later, so they are committed.
 */
export const PANEL_DIRECTORY = '.plot/panels';

/**
 * Where one panel's files live.
 *
 * @param subject - the plan slug the panel questioned.
 * @returns the directory, relative to the repo root.
 */
export const panelDir = (subject: string): string => `${PANEL_DIRECTORY}/${subject}`;

/**
 * One juror's file within a panel.
 *
 * @param subject - the plan slug the panel questioned.
 * @param lens - the persona that wrote it.
 * @param prefix - put before the lens in the file name, so a second round on the
 *   same plan (`verify-`) never overwrites the first. Defaults to none.
 * @returns the file path, relative to the repo root.
 */
export const jurorPath = (subject: string, lens: string, prefix: string = ''): string =>
  `${panelDir(subject)}/${prefix}${lens}.md`;

/** The leading `<n>-` of a file an earlier round was moved to, after its prefix. */
const ROUND_NUMBER = /^(\d+)-/;

/**
 * Whether a file name in a panel directory is an earlier round's file,
 * `<prefix><n>-<rest>`, which {@link archiveRound} names.
 *
 * @param name - the file's base name.
 * @param prefix - the round's prefix, such as `verify-`.
 * @returns `true` for an archived file.
 */
export const isArchivedRound = (name: string, prefix: string): boolean =>
  name.startsWith(prefix) && ROUND_NUMBER.test(name.slice(prefix.length));

/**
 * The moves that archive a panel round's files before the next round with the
 * same prefix writes its own: every `<prefix>*.md` that is not archived yet
 * moves to `<prefix><n>-*.md`, where `n` is one more than the highest archived
 * round. A round with an empty prefix is never archived, because the moves
 * would take every file of the directory.
 *
 * @param names - the base names in the panel directory.
 * @param prefix - the round's prefix, such as `verify-`.
 * @returns the moves, `from` and `to` as base names; empty where there is nothing to move.
 */
export const archiveRound = (
  names: readonly string[],
  prefix: string,
): readonly { readonly from: string; readonly to: string }[] => {
  if (prefix === '') return [];
  const current = names.filter((name) => name.startsWith(prefix) && name.endsWith('.md') && !isArchivedRound(name, prefix));
  const rounds = names
    .filter((name) => isArchivedRound(name, prefix))
    .map((name) => Number(ROUND_NUMBER.exec(name.slice(prefix.length))![1]));
  const round = Math.max(0, ...rounds) + 1;
  return current.map((from) => ({ from, to: `${prefix}${round}-${from.slice(prefix.length)}` }));
};

/**
 * The moderator's reconciliation, which is the panel's one output for a reader.
 *
 * @param subject - the plan slug the panel questioned.
 * @param prefix - put before `panel.md`, as {@link jurorPath} does. Defaults to none.
 * @returns the file path, relative to the repo root.
 */
export const moderationPath = (subject: string, prefix: string = ''): string =>
  `${panelDir(subject)}/${prefix}panel.md`;

/**
 * What a caller requires a juror to commit to.
 *
 * **THE VOCABULARY IS THE CALLER'S, AND THE MECHANISM DOES NOT KNOW IT.** A
 * Draft juror commits to proceed/amend/reject; a delivery juror to
 * supported/refuted plus the command it ran. Hardcoding either is what makes
 * the second caller impossible, and the second caller is the reason this is
 * extracted at all.
 *
 * @property label - the line's key, as it must appear in the file.
 * @property positions - the words that count as a position. A juror writing
 *   anything else has not committed.
 */
export interface Commitment {
  readonly label: string;
  readonly positions: readonly string[];
}

/**
 * A juror's file, read.
 *
 * `committed` carries the position so the moderator never re-parses the file;
 * every other outcome is a refusal carrying the reason a person must act on.
 */
export type JurorReading =
  | { read: 'committed'; lens: string; position: string }
  | { read: 'uncommitted'; lens: string; why: string }
  | { read: 'empty'; lens: string; why: string };

/**
 * The line a juror must write, as the prompt shows it.
 *
 * @param commitment - one required label.
 * @returns `<Label>: <a|b|c>`.
 */
export const commitmentLine = (commitment: Commitment): string =>
  `${commitment.label}: <${commitment.positions.join('|')}>`;

/**
 * Reads one label's committed position out of a juror's file.
 *
 * @param lens - the persona whose file this is.
 * @param text - the file's contents, never empty.
 * @param commitment - the label and words required.
 * @returns the position, or why this label is not committed.
 */
const readLabel = (lens: string, text: string, commitment: Commitment): JurorReading => {
  const label = commitment.label.toLowerCase();
  const claimed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(`${label}:`))
    .map((line) => line.slice(commitment.label.length + 1).trim());

  if (claimed.length === 0) {
    return {
      read: 'uncommitted',
      lens,
      why: `no '${commitment.label}:' line — ${commitmentLine(commitment)}`,
    };
  }

  // EVERY claimed line must name the same position. A juror writing two
  // different ones has hedged in the one place the gate reads, and taking the
  // first would let it. Taking the last would let it too, in the other
  // direction — so neither is taken.
  // `split` always yields at least one element, so the first is never absent —
  // no `?? ''` fallback, which would be a branch no input can reach and which
  // the coverage gate reads as an untested one.
  const positions = claimed.map((c) => {
    const [word] = c.split(/\s/) as [string, ...string[]];
    return commitment.positions.find((p) => p.toLowerCase() === word.toLowerCase());
  });

  if (positions.some((p) => p === undefined)) {
    return {
      read: 'uncommitted',
      lens,
      why: `'${claimed[positions.findIndex((p) => p === undefined)]}' is not one of ${commitment.positions.join(', ')}`,
    };
  }

  const distinct = [...new Set(positions as string[])];
  if (distinct.length > 1) {
    return { read: 'uncommitted', lens, why: `claims both ${distinct.join(' and ')}` };
  }

  return { read: 'committed', lens, position: distinct[0]! };
};

/**
 * Reads a juror's committed position out of its file.
 *
 * **THE GATE, AND IT IS THE PART THAT IS MORE THAN PARALLEL SUBAGENTS.**
 * Fan-out, file-writing and reconciliation all work perfectly with this absent:
 * the panel runs, produces N files and a summary, and looks finished. So the
 * absence of the gate is invisible at runtime, which is exactly why it is a
 * check rather than a sentence in a prompt. CLAUDE.md's own test applies — a
 * juror asked in prose to commit can answer "did I?" with yes without it being
 * true; a juror whose file is refused cannot.
 *
 * **THE LABEL IS MATCHED AT THE START OF A LINE.** A juror discussing the
 * rubric — "the Position line must name one of three words" — mentions the
 * label mid-sentence, and a substring match would read that as the commitment.
 * The measured shape of a hedge is prose, so prose must not be able to satisfy
 * the gate by quoting it.
 *
 * **A POSITION IS MATCHED WHOLE, CASE-INSENSITIVELY.** `reject` must not be
 * satisfied by `rejected-this-reading`, because the position is a word the
 * moderator counts rather than a string it searches.
 *
 * **A LIST GATES EVERY LABEL AND READS THE FIRST.** Given several commitments
 * the file must satisfy all of them. A committed reading carries the position
 * of the first label only; a refusal names every label that failed, joined by
 * `; `, so one send-back can repair them together. A caller that needs each
 * label's own position calls this once per label.
 *
 * @param lens - the persona whose file this is.
 * @param text - the file's contents, or `null` when nothing was written.
 * @param commitment - the shape the caller requires: one label, or a non-empty list.
 * @returns the first label's position, or why this file is not a verdict.
 * @throws when `commitment` is an empty list.
 */
export const readJuror = (
  lens: string,
  text: string | null,
  commitment: Commitment | readonly Commitment[],
): JurorReading => {
  const commitments: readonly Commitment[] = 'label' in commitment ? [commitment] : commitment;
  if (commitments.length === 0) throw new Error('a panel needs at least one commitment');

  if (text === null) return { read: 'empty', lens, why: 'wrote no file' };
  if (text.trim() === '') return { read: 'empty', lens, why: 'wrote an empty file' };

  const readings = commitments.map((c) => readLabel(lens, text, c));
  const refused = readings.filter((r) => r.read !== 'committed');
  if (refused.length === 0) return readings[0]!;
  if (readings.length === 1) return refused[0]!;

  return {
    read: 'uncommitted',
    lens,
    why: refused.map((r) => (r as { why: string }).why).join('; '),
  };
};

/**
 * What a panel amounts to once every juror has been read.
 *
 * **`refused` NAMES THE JURORS RATHER THAN COUNTING THEM**, because the action
 * on a refusal is to send one juror back, and a count says which nobody.
 */
export type PanelReading =
  | { panel: 'refused'; refusals: readonly JurorReading[] }
  | { panel: 'divided'; positions: Readonly<Record<string, readonly string[]>> }
  | { panel: 'unanimous'; position: string; lenses: readonly string[] };

/**
 * Reconciles a panel's readings into what the moderator is handed.
 *
 * **A REFUSED PANEL IS NOT A DIVIDED ONE.** A juror that hedged has not
 * dissented — it has not reviewed, and treating its absence as a minority
 * position would let a panel of four report a 3-1 split it never had. So any
 * refusal refuses the whole panel, and the moderator is never asked to weigh a
 * file that failed the gate.
 *
 * **UNANIMITY IS REPORTED, NEVER SHORT-CIRCUITED.** This says the jurors agreed;
 * it does not say the moderator may be skipped. The plan is explicit that a
 * moderator reading four agreements is how a shared blind spot gets named, and
 * that judgement stays with the caller — which is also why this returns a
 * reading rather than a decision.
 *
 * **A PANEL OF NOBODY IS REFUSED, AND IT SAYS SO.** An empty list is a fan-out
 * that started no juror; reporting it `unanimous` over zero positions is the
 * vacuous-truth reading, and it would report a panel that never ran as a panel
 * that agreed.
 *
 * **ONE READING PER JUROR, OVER THE FIRST LABEL.** A juror gated on several
 * labels is read by {@link readJuror} as its first label, so a panel is
 * reconciled over that label alone and the rest are gated, never folded.
 *
 * @param readings - one per juror.
 * @returns the refusals, the split, or the agreement.
 */
export const readPanel = (readings: readonly JurorReading[]): PanelReading => {
  if (readings.length === 0) {
    return { panel: 'refused', refusals: [{ read: 'empty', lens: '', why: 'the panel had no jurors' }] };
  }

  const refusals = readings.filter((r) => r.read !== 'committed');
  if (refusals.length > 0) return { panel: 'refused', refusals };

  const committed = readings as readonly { read: 'committed'; lens: string; position: string }[];
  const positions: Record<string, string[]> = {};
  for (const r of committed) (positions[r.position] ??= []).push(r.lens);

  const distinct = Object.keys(positions);
  return distinct.length === 1
    ? { panel: 'unanimous', position: distinct[0]!, lenses: positions[distinct[0]!]! }
    : { panel: 'divided', positions };
};
