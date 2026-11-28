/**
 * The readings a supersession needs about its successor, as preconditions for
 * `supersede` (`transitions/plan.ts`).
 *
 * @concept supersede-successor
 */
import type { Precondition, Refusal, RefusalReason } from '../transitions/plan.js';

import { hostAndPathOfRemote } from './remote-url.js';

/** The successor readings, named as their refusals are. */
export type SuccessorRefusal = 'same-plan' | 'successor-not-found' | 'successor-unparsed';

/** A successor `--by` names: a plan in this repository, or one in another repository on the same host. */
export interface SuccessorReference {
  /** `owner/repo` for a plan in another repository; `''` for a plan in this one. */
  readonly repo: string;
  /** The successor plan's slug. */
  readonly slug: string;
}

const SLUG = '[A-Za-z0-9][A-Za-z0-9._-]{0,99}';
const REPO = '[A-Za-z0-9._-]+/[A-Za-z0-9._-]+';
const BARE = new RegExp(`^${SLUG}$`);
const FOREIGN = new RegExp(`^(${REPO}):(${SLUG})$`);

/**
 * Parses what `--by` names as a successor.
 *
 * A bare slug names a plan in this repository. `owner/repo:slug` names a plan
 * in another repository on the same host. The text is trimmed first; any
 * other shape, including whitespace inside it, is `unparsed`.
 *
 * @param by - the successor as given.
 * @returns the reference, or `unparsed`.
 */
export const successorReference = (by: string): SuccessorReference | 'unparsed' => {
  const text = by.trim();
  if (BARE.test(text)) return { repo: '', slug: text };
  const foreign = FOREIGN.exec(text);
  return foreign === null ? 'unparsed' : { repo: foreign[1], slug: foreign[2] };
};

/**
 * This repository's `owner/repo`, read from the path of its remote URL.
 *
 * @param url - the remote URL as git reports it.
 * @returns `owner/repo`, or `null` where the URL names no two-segment path.
 */
export const repositoryOfRemote = (url: string): string | null => {
  const parsed = hostAndPathOfRemote(url.trim().replace(/\/+$/, '').replace(/\.git$/, ''));
  if (parsed === null) return null;
  const path = parsed.path.replace(/^\/+/, '');
  return new RegExp(`^${REPO}$`).test(path) ? path : null;
};

/**
 * Reads a reference against this repository's `owner/repo`: a reference that
 * names this repository becomes a bare slug. The comparison ignores case.
 *
 * @param reference - the parsed reference.
 * @param here - this repository's `owner/repo`, or `null` where it was not read.
 * @returns the reference, with `repo: ''` where it names this repository.
 */
export const successorHere = (
  reference: SuccessorReference | 'unparsed',
  here: string | null,
): SuccessorReference | 'unparsed' =>
  reference !== 'unparsed' && here !== null && reference.repo !== '' && reference.repo.toLowerCase() === here.toLowerCase()
    ? { repo: '', slug: reference.slug }
    : reference;

/**
 * The text a supersession records as its successor: the slug for a plan in
 * this repository, `owner/repo:slug` for one in another.
 *
 * @param reference - the parsed reference.
 * @returns the successor's name as the record carries it.
 */
export const successorName = (reference: SuccessorReference): string =>
  reference.repo === '' ? reference.slug : `${reference.repo}:${reference.slug}`;

/** What the caller measured about the plan and the successor it names. */
export interface SuccessorReading {
  /** The slug of the plan to supersede. */
  readonly slug: string;
  /** The successor as `--by` names it. */
  readonly by: string;
  /** The parsed successor, read against this repository by {@link successorHere}. */
  readonly reference: SuccessorReference | 'unparsed';
  /** The successor's plan file, repository-relative, or `''` where no plan file carries the slug. */
  readonly successorFile: string;
}

/**
 * The preconditions a supersession's successor must meet.
 *
 * `successor-unparsed` is unmet where `by` parses as neither a slug nor
 * `owner/repo:slug`. For a successor in this repository, `same-plan` is unmet
 * where the successor is the plan itself, and `successor-not-found` where the
 * successor names no plan file. A successor in another repository meets no
 * further reading: it is recorded unverified. An empty `by` produces no
 * reading: `supersede` refuses it as `successor-missing`.
 *
 * @param reading - the plan's slug, the successor, its parsed reference, and its file.
 * @returns the readings, `successor-unparsed` alone or `same-plan` first.
 */
export const successorPreconditions = (reading: SuccessorReading): readonly Precondition[] => {
  const by = reading.by.trim();
  if (by === '') return [];
  const { reference } = reading;
  if (reference === 'unparsed') {
    return [
      {
        name: 'successor-unparsed',
        met: false,
        detail: `'${by}' names no successor. Give a plan slug, or 'owner/repo:slug' for a plan in another repository.`,
      },
    ];
  }
  if (reference.repo !== '') return [];
  return [
    {
      name: 'same-plan',
      met: reference.slug !== reading.slug,
      detail: `plan '${reading.slug}' cannot supersede itself. Name the plan that replaces it.`,
    },
    {
      name: 'successor-not-found',
      met: reading.successorFile !== '',
      detail: `no plan file carries the slug '${reference.slug}'. A supersession that points nowhere loses the work. Create the successor plan first, or check the slug.`,
    },
  ];
};

/**
 * The reason a supersession refusal names: the unmet successor reading where
 * `supersede` refused `precondition-unmet` on one, else the refusal's own reason.
 *
 * @param refusal - the refusal `supersede` returned.
 * @param preconditions - the readings it was given.
 * @returns `same-plan`, `successor-not-found`, `successor-unparsed`, or the domain's refusal reason.
 */
export const supersessionRefusalReason = (
  refusal: Refusal,
  preconditions: readonly Precondition[],
): SuccessorRefusal | RefusalReason => {
  if (refusal.reason !== 'precondition-unmet') return refusal.reason;
  const failing = preconditions.find((p) => !p.met)?.name;
  return failing === 'same-plan' || failing === 'successor-not-found' || failing === 'successor-unparsed' ? failing : refusal.reason;
};

/**
 * The plans a person can name as a plan's successor: every other slug the
 * board holds, sorted, without repeats.
 *
 * @param slug - the plan to supersede.
 * @param slugs - the plan slugs the board holds.
 * @returns the candidate successor slugs.
 */
export const successorCandidates = (slug: string, slugs: readonly string[]): readonly string[] =>
  [...new Set(slugs)].filter((s) => s !== slug).sort();

/** Whether a typed successor can be submitted, and why not. */
export interface SuccessorEntry {
  /** The successor to submit, trimmed: a slug, or `owner/repo:slug`. */
  readonly by: string;
  /** Whether the entry can be submitted. */
  readonly ready: boolean;
  /** Why it cannot, or `null` where it can. */
  readonly reason: string | null;
}

/**
 * Reads what a person typed as a plan's successor, through {@link successorReference}.
 *
 * An empty entry is not ready, and neither is an entry that parses as neither
 * a slug nor `owner/repo:slug`, nor the plan's own bare slug. A reference to
 * another repository is ready whatever its slug. Whether the successor has a
 * plan file, and whether `owner/repo` names this repository, are the
 * controller's readings, not this one.
 *
 * @param slug - the plan to supersede.
 * @param typed - the text the person entered.
 * @returns the trimmed successor, and whether and why not it can be submitted.
 */
export const successorEntry = (slug: string, typed: string): SuccessorEntry => {
  const by = typed.trim();
  if (by === '') return { by, ready: false, reason: 'name the successor plan first' };
  const reference = successorReference(by);
  if (reference === 'unparsed') {
    return { by, ready: false, reason: "give a plan slug, or 'owner/repo:slug' for a plan in another repository" };
  }
  if (reference.repo === '' && reference.slug === slug) return { by, ready: false, reason: 'a plan cannot supersede itself' };
  return { by, ready: true, reason: null };
};
