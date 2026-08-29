import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * NOTHING MAY DERIVE THE WAVE VERDICT BY MATCHING PROSE.
 *
 * `AgentRowSchema.verdict` exists because the verdict used to reach the row
 * only as a sentence, and three consumers in turn were built on matching that
 * sentence: `isStartable` compared `note === ELIGIBLE_NOTE`, and the blocker
 * search compared `verdict !== 'complete'`. Both were replaced by fields, and
 * both replacements were prompted by the same near-miss — the notes got sharper
 * (*blocked by an earlier wave* gained the wave's name) and a prose-matching
 * consumer would have gone QUIET rather than failed.
 *
 * That is why this is a GATE and not a paragraph. "Do not build on the prose"
 * is a rule the next author can answer *yes* to without checking, and the
 * failure mode is silence — a button that stops appearing, a colour that stops
 * being applied, with every test still green. A file scan is the only form of
 * the instruction that cannot be answered without doing the work.
 *
 * The constants themselves are exempt: they are DECLARED here, and the two
 * places that write them onto a row are writing prose deliberately. What is
 * forbidden is READING it back — an equality or a regex against the sentence,
 * standing in for the field that now carries the fact.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../src');

/**
 * Comments are stripped before matching, for the reason `no-network.test.ts`
 * records: this file's own subject is discussed at length in `schema.ts` and
 * `fleet.ts` prose, precisely to record why the prose must not be matched. A
 * check that fired on the explanation would push the next author to delete the
 * reasoning in order to go green.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const sources = walk(SRC).map((p) => ({
  file: path.relative(SRC, p),
  code: stripComments(fs.readFileSync(p, 'utf8')),
}));

/** Where each note is DECLARED — the one file allowed to name its own value. */
const DECLARING_FILE = path.join('contract', 'schema.ts');

describe('the verdict is read as a field, never matched as prose', () => {
  it('compares nothing against ELIGIBLE_NOTE', () => {
    // The original offence, and the one the contract named: `isStartable`
    // derived startability from `note === ELIGIBLE_NOTE`. It reads `waitingOn`
    // now, and nothing may reintroduce the shape one field along.
    const offenders = sources.filter(
      (s) => s.file !== DECLARING_FILE && /[=!]==\s*ELIGIBLE_NOTE|ELIGIBLE_NOTE\s*[=!]==/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it('compares nothing against BLOCKED_NOTE either', () => {
    // The neighbour, and the one that would break FIRST: `blockedNote` appends
    // the wave's name, so the sentence a matcher was written against is already
    // not the sentence a blocked row carries.
    const offenders = sources.filter(
      (s) => s.file !== DECLARING_FILE && /[=!]==\s*BLOCKED_NOTE|BLOCKED_NOTE\s*[=!]==/.test(s.code),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it('matches no verdict sentence by regex or substring', () => {
    // The same defect wearing a different operator. `note.includes('eligible')`
    // and `/nobody has taken it/.test(note)` are the equality check with its
    // brittleness hidden, and a regex is worse: it survives a reword just often
    // enough that nobody notices when it stops.
    //
    // READS ONLY — the check is on the OPERATION, not on the sentence, and the
    // distinction is what makes it usable. Two files legitimately contain these
    // words as data: `claim.ts` composes an error message that ends *blocked by
    // an earlier wave*, and `AgentList.tsx` labels the NOT STARTED section
    // *approved — nobody has taken it*. Both WRITE prose for a person to read,
    // which is what prose is for. A check that fired on them would be asking
    // the board to stop explaining itself in order to go green — so it looks
    // for the matcher instead: a `.includes`, a `.test`, a `.match`, a
    // `.startsWith`/`.endsWith`, or a regex literal built from the sentence.
    const phrases = ['nobody has taken it', 'blocked by an earlier wave'];
    const reads = phrases.flatMap((p) => [
      // `note.includes('nobody has taken it')` and its four siblings.
      new RegExp(`\\.(includes|startsWith|endsWith|indexOf|search)\\([^)]*${p}`),
      // `/nobody has taken it/.test(note)` and `note.match(/…/)`.
      new RegExp(`/[^/\\n]*${p}[^/\\n]*/`),
    ]);
    const offenders = sources.filter(
      (s) => s.file !== DECLARING_FILE && reads.some((r) => r.test(s.code)),
    );
    expect(offenders.map((s) => s.file)).toEqual([]);
  });

  it('has the field it replaced the prose with', () => {
    // The positive half, and it is not ceremony: every assertion above passes
    // against a board that deleted the feature outright. `verdict` must be on
    // the contract, typed by the SLICE's own enum, and written onto the row.
    const schema = sources.find((s) => s.file === DECLARING_FILE)!;
    expect(schema.code).toMatch(/verdict:\s*SliceVerdictSchema\.nullable\(\)\.default\(null\)/);
    const fleet = sources.find((s) => s.file === path.join('server', 'fleet.ts'))!;
    expect(fleet.code).toMatch(/verdict,/);
  });
});
