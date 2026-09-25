import { describe, it, expect, vi, afterEach } from 'vitest';
import { run, EXIT } from '../../src/server/entry/panel.js';

/**
 * THE TESTS REPLAY 2026-09-24.
 *
 * `check` split its positions on `,` and asked nothing else of them. A caller
 * who typed the form the tool itself renders — `proceed|amend|reject` — got one
 * position whose single word no juror can write, so every juror was reported as
 * hedging. `/plot-panel` step 4 re-asks a hedging juror, so the skill re-asked a
 * panel that had committed perfectly, and the second run failed identically.
 *
 * The worse shape is `"proceed, amend, reject"`. It splits into three positions
 * of which only the first is trimmed, so the juror writing `proceed` commits and
 * the juror writing `amend` is refused: a DIVIDED PANEL MANUFACTURED BY A TYPO,
 * which a moderator reconciles as a real disagreement.
 *
 * Exit 2 is documented at `entry/panel.ts` as "a broken caller, not a hedging
 * juror". Every `it` below reaches a contract that existed and was never called.
 */

/** A juror's file, committed to `position`. */
const verdict = (position: string) => `Position: ${position}\n`;

/** Runs `check`, capturing stdout and stderr rather than emitting them. */
const check = (positions: string, text: string) => {
  const out: string[] = [];
  const errors: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    errors.push(String(s));
    return true;
  });
  try {
    const code = run(['check', 'Position', positions, 'j'], text, (s) => out.push(s));
    return { code, stdout: out.join(''), stderr: errors.join('') };
  } finally {
    stderr.mockRestore();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('check refuses a vocabulary it cannot use', () => {
  it('refuses the pipe form the tool renders, and reports no juror', () => {
    const { code, stdout, stderr } = check('proceed|amend|reject', verdict('amend'));

    // EXIT 2, NOT 3. A fix that only improves the message still exits 3, and
    // the skill still re-asks a juror that did nothing wrong.
    expect(code).toBe(EXIT.usage);
    expect(stdout).toBe('');
    expect(stderr).toContain('|');
    // THE MESSAGE MUST CARRY THE FIX, not merely name the separator. Echoing
    // the caller's own string back is the trap: `'a|b|c'.split(',')` is one
    // element, so a repair built by trimming it is the broken input verbatim.
    expect(stderr).toContain('proceed,amend,reject');
    expect(stderr).not.toContain('proceed|amend|reject');
  });

  it('suggests a repair the caller can paste back and have accepted', () => {
    const { stderr } = check('proceed|amend|reject', verdict('amend'));

    const suggested = /write '([^']+)'/.exec(stderr)?.[1];
    expect(suggested).toBeDefined();

    // The whole point of naming a repair: running it must work.
    const retry = check(suggested as string, verdict('amend'));
    expect(retry.code).toBe(EXIT.ok);
    expect(retry.stdout).toBe('committed\tj\tamend\n');
  });

  it('refuses a single-word vocabulary — one option is not a commitment', () => {
    const { code, stdout } = check('proceed', verdict('proceed'));

    expect(code).toBe(EXIT.usage);
    expect(stdout).toBe('');
  });

  it('refuses an empty position rather than letting it become one', () => {
    for (const positions of ['proceed,,reject', 'proceed,reject,']) {
      const { code, stdout } = check(positions, verdict('proceed'));

      expect(code, positions).toBe(EXIT.usage);
      expect(stdout, positions).toBe('');
    }
  });

  describe('the whitespace form, asserted as the partial-commit regression', () => {
    // THE PAIR IS THE TEST. Asserting only the `amend` file passes a fix that
    // trims silently; asserting only the `proceed` file passes the unfixed
    // code, which commits it. Both must refuse, with the SAME code.
    const positions = 'proceed, amend, reject';

    it('gives the same exit code to a juror that commits and one that does not', () => {
      const first = check(positions, verdict('proceed'));
      const second = check(positions, verdict('amend'));

      expect(first.code).toBe(EXIT.usage);
      expect(second.code).toBe(EXIT.usage);
      expect(first.code).toBe(second.code);
    });

    it('reports no juror for either file', () => {
      expect(check(positions, verdict('proceed')).stdout).toBe('');
      expect(check(positions, verdict('amend')).stdout).toBe('');
    });

    it('names the repair in the trimmed comma form', () => {
      const { stderr } = check(positions, verdict('amend'));
      expect(stderr).toContain('proceed,amend,reject');

      const suggested = /write '([^']+)'/.exec(stderr)?.[1];
      expect(check(suggested as string, verdict('amend')).code).toBe(EXIT.ok);
    });
  });
});

describe('the comma path is unchanged', () => {
  const positions = 'proceed,amend,reject';

  it('commits a juror that wrote a position in the vocabulary', () => {
    const { code, stdout } = check(positions, verdict('amend'));

    expect(code).toBe(EXIT.ok);
    expect(stdout).toBe('committed\tj\tamend\n');
  });

  it('still exits 3 for a juror that wrote a word outside the vocabulary', () => {
    // A GENUINE HEDGE, and it must stay distinguishable from a broken caller.
    // Without this, a validation that refuses too much passes every test above.
    const { code, stdout } = check(positions, verdict('maybe'));

    expect(code).toBe(EXIT.refused);
    expect(stdout).toContain('uncommitted\tj\t');
  });

  it('still exits 3 for a juror whose file carries no such line', () => {
    const { code, stdout } = check(positions, 'The plan reads well.\n');

    expect(code).toBe(EXIT.refused);
    expect(stdout).not.toBe('');
  });

  it('accepts a two-position vocabulary', () => {
    const { code, stdout } = check('supported,refuted', verdict('refuted'));

    expect(code).toBe(EXIT.ok);
    expect(stdout).toBe('committed\tj\trefuted\n');
  });
});

describe('the usage line shows the comma form', () => {
  it('names it when an argument is missing', () => {
    const errors: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errors.push(String(s));
      return true;
    });
    const code = run(['check', 'Position'], '', () => {});
    stderr.mockRestore();

    expect(code).toBe(EXIT.usage);
    expect(errors.join('')).toContain('<a,b,c>');
  });
});
