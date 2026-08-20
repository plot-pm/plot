import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `vitest.config.ts` runs `test/unit` in parallel and `test/integration`
 * serially, and the split is keyed on the two contended resources: a port and a
 * Chromium process. A file that takes neither has nothing to fight over.
 *
 * That is a claim about the CONTENTS of test/unit, and it was true when measured
 * — zero of the 47 files mentioned `chromium` or `startServer`. Left as a comment
 * it is a rule, and this repo's own guidance says a rule is what an author can
 * answer "did I do this?" about without doing it. So it is a gate.
 *
 * The decay this catches is worse than a red test. Adding `startServer` to a file
 * in test/unit does not fail — it makes the parallel project contend for ports
 * intermittently, and that surfaces as an unrelated test flaking on a busy
 * machine, weeks later, with nothing pointing back here. The whole reason the
 * split is safe is that the group is resource-free; this asserts the premise
 * rather than the conclusion.
 *
 * A file that legitimately needs either resource is not wrong — it belongs in
 * test/integration, which is what the failure message says.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const UNIT_DIR = here;
const SELF = path.basename(fileURLToPath(import.meta.url));

/**
 * Comments are stripped before matching, for the reason `no-network.test.ts`
 * gives: this file is looking for USES, and a test that fired on prose would
 * push the next author to delete an explanation to go green. This very file
 * names both markers in its own header.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const sources = fs
  .readdirSync(UNIT_DIR)
  // Excluding self, and not because self-exclusion is tidy: both markers appear
  // in this file's own assertion MESSAGES, which are string literals that
  // stripComments correctly leaves alone. Contorting those strings to dodge the
  // grep would cost the one thing that makes the gate useful — a message that
  // tells whoever trips it what to do.
  .filter((f) => f.endsWith('.test.ts') && f !== SELF)
  .map((f) => ({
    file: f,
    code: stripComments(fs.readFileSync(path.join(UNIT_DIR, f), 'utf8')),
  }));

describe('the parallel project takes neither contended resource', () => {
  it('finds the unit files at all, so an empty read cannot pass silently', () => {
    // Without this, a wrong UNIT_DIR would make every assertion below vacuous.
    expect(sources.length).toBeGreaterThan(40);
  });

  it('launches no browser — no file in test/unit mentions chromium', () => {
    const offenders = sources.filter((s) => /chromium/i.test(s.code)).map((s) => s.file);
    expect(
      offenders,
      `test/unit runs with fileParallelism: true, so a browser launched here contends ` +
        `with every other file's. Move these to test/integration: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('binds no port — no file in test/unit spawns a board server', () => {
    const offenders = sources
      .filter((s) => /startServer|spawnBoard|listen\(/.test(s.code))
      .map((s) => s.file);
    expect(
      offenders,
      `test/unit runs with fileParallelism: true. A server spawned here is fine on ` +
        `PORT=0 but the split does not depend on that, and the serial project is ` +
        `where a port-taking file belongs. Move these to test/integration: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
