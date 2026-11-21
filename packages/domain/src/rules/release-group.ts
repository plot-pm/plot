import { compareSemver, isSemver, normalizeVersion } from '../entities/version.js';
import type { PersonDirectory } from '../entities/person.js';
import type { DeliveryInput, DeliveryReadings } from './delivery-placement.js';
import type { DeliveryScopeKind } from './delivery-scope.js';
import type { PasskeyRegistration } from './passkey-settings.js';
import { releaseApprovable, type ReleaseApprovable, type ReleasePrReading } from './release-approvable.js';
import {
  NO_RELEASE_TARGETED,
  RELEASE_READING_MISSING,
  peopleOf,
  releaseCardApprovable,
  type ReleaseCardKind,
  type ReleaseCardView,
  type ReleaseRowReading,
} from './release-card.js';
import { SLICE_STATES, type CountedSlice } from './slice-states.js';
import { sprintBarOf, type BarSegment, type SprintCardSprint } from './sprint-card.js';

/** The last version a plan records as released, and the date of that record. */
export interface LastRelease {
  /** The version with its `v`, such as `v2.35.0`. */
  readonly tag: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}

/**
 * The highest release among the plans' `Released:` records.
 *
 * A record reads `YYYY-MM-DD, vX.Y.Z` or `YYYY-MM-DD, X.Y.Z`; the version ends at the first space, so
 * prose after it is ignored. Versions compare by semver through `normalizeVersion`, and a pre-release
 * sorts below its release. A record whose date or version does not parse is skipped. Of two records
 * for one version, the earlier date is kept.
 *
 * @param records - every plan's `Released:` value as written, `''` where a plan has none.
 * @returns the highest version and its date, or `null` where no record parses.
 */
export const lastRelease = (records: readonly string[]): LastRelease | null => {
  let best: LastRelease | null = null;
  for (const record of records) {
    const match = /^\s*(\d{4}-\d{2}-\d{2})\s*,\s*(\S+)/.exec(record);
    if (match === null || !isSemver(match[2]!)) continue;
    const found = { tag: normalizeVersion(match[2]!), date: match[1]! };
    const order = best === null ? 1 : compareSemver(found.tag, best.tag);
    if (order > 0 || (order === 0 && best !== null && found.date < best.date)) best = found;
  }
  return best;
};

/**
 * The words of a group that targets no release.
 *
 * @param last - the last release, `null` where none is recorded.
 * @returns `No release targeted · last v2.35.0 2026-11-01`, or `No release targeted` alone where `last` is `null`.
 */
export const noReleaseClause = (last: LastRelease | null): string =>
  last === null ? NO_RELEASE_TARGETED : `${NO_RELEASE_TARGETED} · last ${last.tag} ${last.date}`;

/** The sprint fields the Release group reads. */
export type ReleaseGroupSprint = Pick<SprintCardSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>;

/** One release the group can approve: a card of the group and the release row it binds. */
export interface ReleaseCandidate {
  readonly key: string;
  /** The card's anchor, which the to-do list's "Approve release" line jumps to. */
  readonly anchor: string;
  /** The version without its `v`, `''` where not read. */
  readonly version: string;
  /** The bound release row's work item id, `null` where none binds. */
  readonly rowId: string | null;
  /** The bound row's PR number, `null` where none binds or the row carries none. */
  readonly pr: number | null;
  /** Why the button is disabled before any PR reading, `''` where a row binds. */
  readonly unboundReason: string;
}

/** The Delivery tab header's Release group over every sprint in scope. */
export interface ReleaseGroupView {
  readonly scope: DeliveryScopeKind;
  /** `targeted` where a card names a version a sprint targets, `untargeted` for release rows alone, `none` otherwise. */
  readonly kind: ReleaseCardKind;
  /** The versions in card order, joined: `2.36.0 · 2.37.0`; `noReleaseClause` for `none`. */
  readonly title: string;
  /** `all sprints · 3 people`, `my sprint · <a>`, or `my sprints · <a>, <b>`. */
  readonly scopeLine: string;
  /** The sprints in scope that the group names by title: the reader's sprints under `my-sprint`, none under `release`. */
  readonly sprints: readonly { slug: string; title: string }[];
  /** Five segments in `SLICE_STATES` order, the sum of the per-sprint bars; `null` where unread or where nothing is counted. */
  readonly bar: readonly BarSegment[] | null;
  readonly total: number;
  /** True where any sprint in scope has no merge answer. The bar is then grey, never a partial count. */
  readonly readingMissing: boolean;
  /** The releases the action slot can hold, in card order. */
  readonly candidates: readonly ReleaseCandidate[];
  /** Sprints whose Owner `People` does not declare, from `sprintCards`. */
  readonly unknownOwners: readonly { slug: string; handle: string }[];
}

/** What `releaseGroup` reads. */
export interface ReleaseGroupInput {
  readonly scope: DeliveryScopeKind;
  /** The sprints in scope: every Active sprint for `release`, the reader's selected ones for `my-sprint`. */
  readonly sprints: readonly ReleaseGroupSprint[];
  /** `releaseCards` over the same sprints. */
  readonly cards: readonly ReleaseCardView[];
  /** The release rows `cards` were built over. */
  readonly rows: readonly ReleaseRowReading[];
  readonly directory: PersonDirectory;
  readonly slicesByPlan: ReadonlyMap<string, readonly CountedSlice[] | undefined>;
  readonly readings: DeliveryReadings;
  readonly input: DeliveryInput;
  readonly unknownOwners: readonly { slug: string; handle: string }[];
  readonly lastRelease: LastRelease | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const sum = (bars: readonly (readonly BarSegment[])[]): BarSegment[] =>
  SLICE_STATES.map((state) => ({ state, count: bars.reduce((n, bar) => n + (bar.find((s) => s.state === state)?.count ?? 0), 0) }));

/**
 * The Release group: one title, scope line, bar and set of candidates over every sprint in scope.
 *
 * The bar is the sum of `sprintBarOf` over the sprints in scope, five segments, and is `null` with
 * `readingMissing` where any of them has no merge answer. With no sprint in scope, the bar is the
 * bar of the first `untargeted` card, which counts the Release delivery section's plans. Under
 * `my-sprint` the group keeps only `targeted` cards: a release row the reader's sprints do not name
 * is not theirs to approve.
 *
 * @param group - the scope, its sprints, the release cards over them and the readings behind the bars.
 * @returns the group.
 */
export const releaseGroup = (group: ReleaseGroupInput): ReleaseGroupView => {
  const { scope, sprints } = group;
  const cards = group.cards.filter((c) => c.kind !== 'none' && (scope === 'release' || c.kind === 'targeted'));
  const perSprint = sprints.map((s) => sprintBarOf(s, group.slicesByPlan, group.readings, group.input));
  const untargeted = cards.find((c) => c.kind === 'untargeted');
  const readingMissing = sprints.length > 0 ? perSprint.some((b) => b.readingMissing) : untargeted?.readingMissing ?? false;
  const bar = readingMissing ? null
    : sprints.length > 0 ? sum(perSprint.map((b) => b.bar!))
    : untargeted?.bar ?? null;
  const kind: ReleaseCardKind = cards.length === 0 ? 'none' : cards.some((c) => c.kind === 'targeted') ? 'targeted' : 'untargeted';
  const versions = cards.map((c) => c.version).filter((v, i, all) => v !== '' && all.indexOf(v) === i);
  const title = kind === 'none' ? noReleaseClause(group.lastRelease)
    : versions.length === 0 ? 'Release (version not read)' : versions.join(' · ');
  const names = sprints.map((s) => s.title.trim() || s.slug);
  const scopeLine = scope === 'release'
    ? `all sprints · ${plural(peopleOf(sprints.map((s) => s.ownerHandle), group.directory), 'person', 'people')}`
    : `${sprints.length === 1 ? 'my sprint' : 'my sprints'} · ${names.join(', ')}`;
  const prOf = (rowId: string | null): number | null => group.rows.find((r) => r.id === rowId)?.pr ?? null;
  const candidates = (cards.length > 0 ? cards : group.cards.filter((c) => c.kind === 'none')).map((c) => ({
    key: c.key, anchor: c.anchor, version: c.version, rowId: c.rowId, pr: prOf(c.rowId), unboundReason: c.unboundReason,
  }));
  return {
    scope,
    kind,
    title,
    scopeLine,
    sprints: scope === 'my-sprint' ? sprints.map((s, i) => ({ slug: s.slug, title: names[i]! })) : [],
    bar,
    total: bar === null ? 0 : bar.reduce((n, s) => n + s.count, 0),
    readingMissing,
    candidates: candidates.length > 0 ? candidates : [{ key: 'release:none', anchor: 'release-card-none', version: '', rowId: null, pr: null, unboundReason: 'no release PR exists' }],
    unknownOwners: group.unknownOwners,
  };
};

/** One ready release PR the action slot does not hold. */
export interface ReleaseReadyOther {
  readonly key: string;
  readonly version: string;
  /** The bound release row's work item id. */
  readonly rowId: string;
  readonly pr: number;
}

/** The Release group's status line and its button, decided together. */
export interface ReleaseStatusLine {
  /** The status line: `Release PR #300 ready`, the disabled button's reason, or `RELEASE_READING_MISSING`. */
  readonly text: string;
  /** The candidate the action slot holds. */
  readonly slot: ReleaseCandidate;
  /** The button's state and reason. */
  readonly button: ReleaseApprovable;
  /** The other ready release PRs, lowest version first. */
  readonly others: readonly ReleaseReadyOther[];
  /** `+1 more ready`, `null` where `others` is empty. */
  readonly more: string | null;
}

/**
 * The Release group's status line and release button, from one decision.
 *
 * A candidate is ready where its PR reading passes `releaseApprovable` with a registered passkey. The
 * slot holds the ready candidate with the lowest version by semver; with none ready, the bound
 * candidate with the lowest version; with none bound, the first candidate. The button is
 * `releaseCardApprovable` of the slot with `passkey`, so a `null` passkey reads as unread
 * (`APPROVE_PENDING`), never as unregistered. The text is `Release PR #N ready` where the button is
 * enabled, that line and the reason where only the passkey holds it, and the reason otherwise. Where
 * the group's reading is missing, the text is `RELEASE_READING_MISSING` and the button keeps its answer.
 *
 * @param group - the Release group.
 * @param prReading - each bound row's PR reading, by `rowId`; a missing key reads as no reading.
 * @param passkey - the registration answer, `null` while unread or where the read failed.
 * @returns the text, the slot, the button and the other ready PRs.
 */
export const releaseStatusLine = (
  group: Pick<ReleaseGroupView, 'candidates' | 'readingMissing'>,
  prReading: Readonly<Record<string, ReleasePrReading | null>>,
  passkey: PasskeyRegistration | null,
): ReleaseStatusLine => {
  const readingOf = (c: ReleaseCandidate): ReleasePrReading | null => (c.rowId === null ? null : prReading[c.rowId] ?? null);
  const byVersion = (a: ReleaseCandidate, b: ReleaseCandidate): number => compareSemver(a.version, b.version);
  const ready = group.candidates
    .filter((c) => c.rowId !== null && c.pr !== null && releaseApprovable(readingOf(c), { registered: true }).state === 'enabled')
    .sort(byVersion);
  const bound = group.candidates.filter((c) => c.rowId !== null).sort(byVersion);
  const slot = ready[0] ?? bound[0] ?? group.candidates[0]!;
  const button = releaseCardApprovable(slot, readingOf(slot), passkey);
  const others = ready.filter((c) => c !== slot).map((c) => ({ key: c.key, version: c.version, rowId: c.rowId!, pr: c.pr! }));
  const readyLine = ready[0] === slot ? `Release PR #${slot.pr} ready` : null;
  const text = group.readingMissing ? RELEASE_READING_MISSING
    : button.state === 'enabled' ? readyLine!
    : readyLine !== null ? `${readyLine} · ${button.reason}`
    : button.reason;
  return { text, slot, button, others, more: others.length === 0 ? null : `+${others.length} more ready` };
};
