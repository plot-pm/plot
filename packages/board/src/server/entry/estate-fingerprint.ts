import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { refsGit, shellContext } from '@plot-pm/domain/adapters';
import { isAnswered } from '@plot-pm/domain';

import type { BuildBoardOptions } from '../board.js';

/**
 * A measurement of the estate the scan would read, cheap enough to take before
 * every ask.
 *
 * **A measurement, never a timer.** A cache keyed on elapsed time answers "was
 * it recent?" when the question is "did it change?", and those differ in the
 * one direction that matters: a fix applied between two asks is exactly the
 * case where the estate changed and the clock did not care. So this hashes what
 * the scan reads, and any difference is a miss.
 *
 * @see {@link estateFingerprint} for what is hashed and what is deliberately
 * left out.
 */
export interface EstateFingerprint {
  /** The digest two asks are compared on. */
  digest: string;
  /** What went into it, for a caller that wants to say why a cache missed. */
  refs: number;
  plans: number;
}

/**
 * Every remote ref and the object it points at.
 *
 * The scan derives its branch state from `origin/*` — merged, stale, claimed,
 * in flight — so a ref that has not moved cannot change any of those answers.
 * The SHA rather than the ref NAME: a branch force-pushed between two asks
 * keeps its name and is a different estate.
 *
 * Measured on this repo 2026-08-31: 32 refs in 7 ms, against a scan that runs
 * for minutes. That ratio is what makes the guard honest rather than a bet —
 * the measurement cannot plausibly cost more than the answer it saves.
 */
const refState = (repoRoot: string): string[] => {
  const read = refsGit(shellContext(repoRoot)).refStateSync('remote');
  // A repo git cannot be asked about is one whose estate cannot be measured,
  // and an unmeasurable estate must never compare EQUAL to a previous one. The
  // caller turns the empty list into a miss; see `sameEstate`.
  if (!isAnswered(read)) return [];
  return read.value.map(({ ref, sha }) => `${ref} ${sha}`).sort();
};

/**
 * Every plan file's path and content hash.
 *
 * The scan reads plan CONTENT — phase, records, branch lines — so a phase flip
 * is an estate change even though no ref moved. That is precisely the gate's
 * own fix: it edits a plan and pushes, and the second ask must see both halves.
 *
 * Content rather than mtime, for the reason the terminal cache gives one layer
 * down: mtime is a clock, and a checkout or a `touch` moves it without changing
 * what the scan would read. Hashing 183 files costs milliseconds.
 */
const planState = (repoRoot: string, planDir: string): string[] => {
  const dir = path.join(repoRoot, planDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    try {
      const body = fs.readFileSync(path.join(dir, name));
      return `${name} ${crypto.createHash('sha1').update(body).digest('hex')}`;
    } catch {
      // Raced with a delete. Named as unreadable rather than skipped: a file
      // that vanished between two asks IS a difference, and dropping it
      // silently would make the two digests agree about different estates.
      return `${name} <unreadable>`;
    }
  });
};

/**
 * Measure the estate the scan would read.
 *
 * **What is deliberately NOT in the digest: the host's open-PR set.** The scan
 * asks the git host which PRs are open, and that is a fact on a server this
 * process cannot observe without paying the very network call the cache exists
 * to avoid — a fingerprint that asked would cost what it saves.
 *
 * That omission is what bounds the cache's LIFETIME rather than being a hole in
 * it. A fingerprint that cannot see a remote change must not outlive a caller's
 * own run, so this cache is per-process and per-loop: see
 * {@link askOncePerEstate}. Inside one gate loop the estate changes because the
 * gate itself changed it — a local edit and a push, both of which the digest
 * sees. Between two operator runs, a new process takes a fresh measurement.
 *
 * @param opts where the repository is
 * @param planDir the configured plan directory, repo-relative
 * @returns the digest and its input counts
 */
export const estateFingerprint = (
  opts: BuildBoardOptions,
  planDir = 'docs/plans',
): EstateFingerprint => {
  const refs = refState(opts.repoRoot);
  const plans = planState(opts.repoRoot, planDir);
  const digest = crypto
    .createHash('sha256')
    // The section markers keep two inputs from forging one digest between them:
    // without them a ref line and a plan line could trade characters across the
    // join and hash the same.
    .update(`refs\n${refs.join('\n')}\nplans\n${plans.join('\n')}\n`)
    .digest('hex');
  return { digest, refs: refs.length, plans: plans.length };
};

/**
 * Whether two measurements describe the same estate.
 *
 * **An unmeasurable estate is never equal to anything, including itself.** When
 * `refs` and `plans` are both zero the measurement failed — no git, no plan
 * directory — and a cache that treated two failures as agreement would serve a
 * stale answer precisely when it knows least. Failing to a miss costs a scan;
 * failing to a hit costs a wrong delivery gate.
 *
 * @param a the earlier measurement
 * @param b the later one
 * @returns true only when both measured something and measured the same thing
 */
export const sameEstate = (a: EstateFingerprint, b: EstateFingerprint): boolean =>
  a.refs + a.plans > 0 && b.refs + b.plans > 0 && a.digest === b.digest;
