import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SprintCountsSchema } from '../../src/contract/schema.js';

/**
 * THE FOURTH COUNT REACHES THE SCREEN.
 *
 * `estateTotals` and `activeSprints` tally `withdrawn` and `fleet-sprints.test.ts`
 * asserts the numbers; this asserts the term is PRINTED. The two are separate
 * failures: a bucket counted correctly and rendered nowhere leaves a reader
 * adding three terms against a total that includes a fourth, which is the same
 * unexplained shortfall the additive bucket was chosen to avoid.
 *
 * THE SOURCE IS READ, NOT RENDERED. Vitest runs `environment: 'node'` here with
 * no jsdom and no React Testing Library, so `SprintFilter` cannot be mounted —
 * `acting-spinner.test.ts` settles the convention this follows. `formatCounts`
 * is module-private, and exporting it to reach a test would widen the module's
 * API for the test's convenience rather than the component's.
 *
 * COMMENTS ARE STRIPPED, for that file's measured reason: this component's own
 * docstring names every bucket and the word `withdrawn` several times, so an
 * assertion over the prose would pass with the template untouched.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

const src = (rel: string) =>
  fs.readFileSync(path.resolve(here, '../../src/app', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const SPRINT_FILTER = src('components/SprintFilter.tsx');

/** The template literal `formatCounts` returns, comments already gone. */
const countsTemplate = () => {
  const body = SPRINT_FILTER.split('function formatCounts')[1] ?? '';
  return body.split('\n}')[0] ?? '';
};

describe('the withdrawn count is rendered, not only tallied', () => {
  it('prints every bucket the schema declares', () => {
    // DERIVED FROM THE SCHEMA rather than listing four words here. A fifth
    // bucket added to `SprintCountsSchema` and rendered nowhere fails this
    // test, which is the failure that matters — a hardcoded list would need
    // the same edit twice and would pass after only one.
    const template = countsTemplate();
    const buckets = Object.keys(SprintCountsSchema.shape).filter((k) => k !== 'total');
    for (const bucket of buckets) {
      expect(template).toContain(`counts.${bucket}`);
    }
  });

  it('labels the fourth bucket with the word the estate already uses', () => {
    // The one decision the plan left open. `withdrawn` is the word the phase
    // transition, the status member and the plan all use; `closed` collides
    // with a PR's vocabulary and `rejected` names one of the two phases.
    expect(countsTemplate()).toContain('withdrawn');
  });

  it('prints the withdrawn term unconditionally — no zero-hiding', () => {
    // A count shown only when non-zero would read as a three-bucket total on
    // most estates, and a reader checking `open + wip + done` against `total`
    // would find it short exactly when a plan had been withdrawn — the gap
    // this work closed. No ternary, no `&&`, no `> 0` guard around the term.
    const template = countsTemplate();
    const withdrawnTerm = template.slice(template.indexOf('counts.withdrawn'));
    expect(withdrawnTerm).not.toMatch(/[?&]{1,2}/);
  });
});
