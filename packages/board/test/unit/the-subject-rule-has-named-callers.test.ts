import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * THE SUBJECT RULE HAS NAMED CALLERS — who may read a merge subject.
 *
 * ## What this is, and what it is not
 *
 * It is NOT the boundary's gate. The subject reaches delivery as PULSE DATA
 * and not as an import, so no import test can stop that — what stops it is
 * `allSlicesConfirmed`, tested in the domain, and the tick tests over a parsed
 * pulse. This asserts the narrower thing an import test CAN assert: that the
 * rule itself is reached only where the plan says, so a later change that
 * wires it into a destructive path is visible in a diff rather than in a
 * behaviour nobody looks for.
 *
 * ## Why it matches identifiers rather than module paths
 *
 * A module path can be reached by a re-export, a barrel, or a relative spelling
 * that no grep for `@plot-pm/domain/rules/merge-subject` would find. The
 * identifier travels with the call, so `mergedBySubject(` is the same text
 * wherever it is reached from.
 *
 * ## Why only `packages/*​/src`
 *
 * Test files and `packages/domain/corpus/` are outside its scope by
 * construction: the rule's own tests call it, and the corpus tier calls it
 * deliberately — that is what replaced the third copy of the regex.
 */

/** The repository root, from this file. */
const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * Every `.ts`/`.tsx` file under a package's `src`, recursively.
 *
 * @param dir - the directory to walk.
 * @returns absolute paths.
 */
const sourcesUnder = (dir: string): string[] => {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out = out.concat(sourcesUnder(path));
      continue;
    }
    if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path);
  }
  return out;
};

/** Every package's `src`, which is the whole of this test's scope. */
const SOURCES = readdirSync(join(ROOT, 'packages'))
  .map((pkg) => join(ROOT, 'packages', pkg, 'src'))
  .filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap(sourcesUnder);

/**
 * The files naming an identifier, repository-relative and sorted.
 *
 * @param identifier - the identifier to look for.
 * @returns the paths, sorted.
 */
const callersOf = (identifier: string): string[] =>
  SOURCES
    .filter((path) => readFileSync(path, 'utf8').includes(identifier))
    .map((path) => relative(ROOT, path))
    .sort();

describe('the subject rule has named callers', () => {
  it('finds sources to read', () => {
    // A walk that found nothing would make every assertion below vacuous —
    // the shape this repository has been bitten by before.
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  // THE RULE ITSELF. Reached by the bundle that answers for the scan and by
  // the supervisor's queue world, which reads the same rule.
  it('names `mergedBySubject` only where the rule is asked', () => {
    expect(callersOf('mergedBySubject')).toEqual([
      'packages/board/src/server/entry/merge-subject.ts',
      'packages/board/src/server/entry/registryd-main.ts',
      'packages/domain/src/rules/merge-subject.ts',
    ]);
  });

  it('names `ownerOfRemote` only where the owner is read', () => {
    expect(callersOf('ownerOfRemote')).toEqual([
      'packages/board/src/server/entry/merge-subject.ts',
      'packages/board/src/server/entry/registryd-main.ts',
      'packages/domain/src/rules/remote-owner.ts',
    ]);
  });

  // THE SUPERVISOR'S SEAM. The queue receives sets of branches through
  // `subjectProven`, and the merges walk is a refs-port reading.
  it('names `subjectProven` only in the queue and the world that answers it', () => {
    expect(callersOf('subjectProven')).toEqual([
      'packages/board/src/server/entry/registryd-main.ts',
      'packages/board/src/server/queue-reading.ts',
    ]);
  });

  it('names `mergeSubjects` only in the refs port, its adapters and the queue world', () => {
    expect(callersOf('mergeSubjects')).toEqual([
      'packages/board/src/server/entry/registryd-main.ts',
      'packages/domain/src/adapters/refs/refs-fixture.ts',
      'packages/domain/src/adapters/refs/refs-git.ts',
      'packages/domain/src/ports/refs.ts',
    ]);
  });

  // THE DESTRUCTIVE READERS, asserted to name none of it. Each starts
  // something that cannot be undone — a delivery, a reap, a ref deletion — and
  // each reads the host's own answer instead.
  it.each([
    'packages/board/src/server/controllers/deliverability.ts',
    'packages/domain/src/rules/landed.ts',
    'packages/board/src/server/auto-deliver.ts',
  ])('%s reads no subject rule', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).not.toContain('mergedBySubject');
    expect(source).not.toContain('ownerOfRemote');
    expect(source).not.toContain('mergeSubjectForms');
    expect(source).not.toContain('subjectProven');
    expect(source).not.toContain('mergeSubjects');
  });

  // THE FORMS, which carry the vendor words. They belong to the host adapter
  // and to the two entries that ask it — a domain rule holding one would fail
  // the vendor gate, and `queue-reading.ts` holding one would put a vendor word
  // outside the vendor gate's root.
  it('names `mergeSubjectForms` only in the adapter and the two entries', () => {
    expect(callersOf('mergeSubjectForms')).toEqual([
      'packages/board/src/server/entry/merge-subject.ts',
      'packages/board/src/server/entry/registryd-main.ts',
      'packages/domain/src/adapters/host/merge-subjects.ts',
    ]);
  });
});
