import { describe, it, expect } from 'vitest';
import {
  PANEL_DIRECTORY,
  commitmentLine,
  jurorPath,
  moderationPath,
  panelDir,
  readJuror,
  readPanel,
  type Commitment,
  type JurorReading,
} from '../src/rules/panel.js';

/**
 * The panel's gate, and the reason it is a test rather than a sentence.
 *
 * Fan-out, file-writing and reconciliation all work with the gate absent: the
 * panel runs, produces N files and a summary, and looks finished. A test
 * asserting that N files appeared would pass against no gate at all — so what
 * is asserted here is the REFUSAL, on each shape a hedge actually takes.
 */

/** What `/challenge-the-plan` would require of a Draft juror. */
const draft: Commitment = { label: 'Position', positions: ['proceed', 'amend', 'reject'] };

/** What `/plot-deliver` step 5 would require of a delivery juror. */
const delivery: Commitment = { label: 'Finding', positions: ['supported', 'refuted'] };

const committed = (lens: string, position: string): JurorReading => ({
  read: 'committed',
  lens,
  position,
});

describe('the commitment gate refuses a verdict that names no position', () => {
  it('refuses a file that never writes the line', () => {
    const reading = readJuror(
      'contracts',
      'The plan is broadly sound. I have some reservations about the second slice.',
      draft,
    );

    expect(reading.read).toBe('uncommitted');
    if (reading.read !== 'uncommitted') throw new Error('unreachable');
    expect(reading.why).toContain('Position');
  });

  it('refuses a word that is not one of the caller-supplied positions', () => {
    const reading = readJuror('contracts', 'Position: maybe', draft);

    expect(reading.read).toBe('uncommitted');
    if (reading.read !== 'uncommitted') throw new Error('unreachable');
    expect(reading.why).toContain('proceed, amend, reject');
  });

  it('refuses a juror that wrote nothing at all', () => {
    expect(readJuror('contracts', null, draft).read).toBe('empty');
    expect(readJuror('contracts', '   \n\n', draft).read).toBe('empty');
  });

  it('refuses a file that claims two different positions', () => {
    // The hedge that lives INSIDE the gate's own field. Taking the first line
    // lets it through; taking the last lets it through the other way.
    const reading = readJuror(
      'contracts',
      'Position: proceed\n\nOn reflection:\n\nPosition: reject',
      draft,
    );

    expect(reading.read).toBe('uncommitted');
    if (reading.read !== 'uncommitted') throw new Error('unreachable');
    expect(reading.why).toContain('proceed');
    expect(reading.why).toContain('reject');
  });

  it('refuses a juror that only quotes the rubric mid-sentence', () => {
    // A juror explaining the rules mentions the label. A substring match would
    // read the explanation as the commitment.
    const reading = readJuror(
      'contracts',
      'The brief says my Position: line must name one of three words. I found three issues.',
      draft,
    );

    expect(reading.read).toBe('uncommitted');
  });
});

describe('the gate accepts a juror that committed', () => {
  it('reads the position out of the line', () => {
    const reading = readJuror('contracts', '# Contracts\n\nPosition: amend\n\nBecause...', draft);

    expect(reading).toEqual({ read: 'committed', lens: 'contracts', position: 'amend' });
  });

  it('accepts the position whatever its case, and ignores what trails it', () => {
    const reading = readJuror('evidence', 'Finding: SUPPORTED — ran `pnpm test`, 412 passed', delivery);

    expect(reading).toEqual({ read: 'committed', lens: 'evidence', position: 'supported' });
  });

  it('accepts a file repeating one position', () => {
    const reading = readJuror('contracts', 'Position: reject\n...\nPosition: reject', draft);

    expect(reading.read).toBe('committed');
  });
});

describe('the mechanism does not know the vocabulary', () => {
  it('validates a delivery juror against the delivery words, not the draft ones', () => {
    // The same text is a commitment under one caller and a refusal under the
    // other. Hardcoding either vocabulary is what makes the second caller
    // impossible, and the second caller is why this is extracted at all.
    expect(readJuror('evidence', 'Finding: refuted', delivery).read).toBe('committed');
    expect(readJuror('evidence', 'Finding: refuted', draft).read).toBe('uncommitted');
    expect(readJuror('contracts', 'Position: proceed', delivery).read).toBe('uncommitted');
  });

  it('shows the caller the line it requires', () => {
    expect(commitmentLine(draft)).toBe('Position: <proceed|amend|reject>');
    expect(commitmentLine(delivery)).toBe('Finding: <supported|refuted>');
  });
});

describe('a panel is refused when any juror is', () => {
  it('refuses the whole panel on one hedge, and names who', () => {
    // A juror that hedged has not dissented — it has not reviewed. Counting it
    // as a minority position would report a 3-1 split the panel never had.
    const reading = readPanel([
      committed('contracts', 'proceed'),
      committed('evidence', 'proceed'),
      { read: 'uncommitted', lens: 'scope', why: "no 'Position:' line" },
    ]);

    expect(reading.panel).toBe('refused');
    if (reading.panel !== 'refused') throw new Error('unreachable');
    expect(reading.refusals.map((r) => r.lens)).toEqual(['scope']);
  });

  it('refuses a panel that started no juror rather than calling it unanimous', () => {
    const reading = readPanel([]);

    expect(reading.panel).toBe('refused');
    if (reading.panel !== 'refused') throw new Error('unreachable');
    const first = reading.refusals[0];
    expect(first?.read).toBe('empty');
    if (first === undefined || first.read === 'committed') throw new Error('unreachable');
    expect(first.why).toContain('no jurors');
  });
});

describe('a panel that committed is reconciled, never averaged', () => {
  it('names each position and who holds it', () => {
    const reading = readPanel([
      committed('contracts', 'amend'),
      committed('evidence', 'proceed'),
      committed('scope', 'amend'),
    ]);

    expect(reading).toEqual({
      panel: 'divided',
      positions: { amend: ['contracts', 'scope'], proceed: ['evidence'] },
    });
  });

  it('reports unanimity as a reading, leaving the moderator to the caller', () => {
    // Explicitly NOT a licence to skip reconciliation: a moderator reading four
    // agreements is how a shared blind spot gets named.
    const reading = readPanel([committed('contracts', 'proceed'), committed('evidence', 'proceed')]);

    expect(reading).toEqual({
      panel: 'unanimous',
      position: 'proceed',
      lenses: ['contracts', 'evidence'],
    });
  });
});

describe('where a panel writes is a stated decision', () => {
  it('puts a panel outside the machine-local state directory', () => {
    // `.gitignore:30` ignores `.plot/state/` and tracks the rest of `.plot/`.
    // A desk is reaped, so verdicts written under state/ die with the worktree.
    expect(PANEL_DIRECTORY).toBe('.plot/panels');
    expect(PANEL_DIRECTORY.startsWith('.plot/state')).toBe(false);
  });

  it('gives each subject its own directory and each juror its own file', () => {
    expect(panelDir('a-panel-questions-one-plan')).toBe('.plot/panels/a-panel-questions-one-plan');
    expect(jurorPath('a-panel-questions-one-plan', 'contracts')).toBe(
      '.plot/panels/a-panel-questions-one-plan/contracts.md',
    );
    expect(moderationPath('a-panel-questions-one-plan')).toBe(
      '.plot/panels/a-panel-questions-one-plan/panel.md',
    );
  });
});

describe('a list of commitments gates every label and reads the first', () => {
  const claim = (n: number): Commitment => ({
    label: `Claim-${n}`,
    positions: ['supported', 'refuted'],
  });
  const list = [draft, claim(1), claim(2)];

  it('commits on the first label when every label is satisfied', () => {
    const text = 'Position: amend\nClaim-1: supported\nClaim-2: refuted\n';

    expect(readJuror('evidence', text, list)).toEqual({
      read: 'committed',
      lens: 'evidence',
      position: 'amend',
    });
  });

  it('refuses a juror that omits one label, naming it', () => {
    const reading = readJuror('evidence', 'Position: amend\nClaim-1: supported\n', list);

    expect(reading.read).toBe('uncommitted');
    if (reading.read !== 'uncommitted') throw new Error('unreachable');
    expect(reading.why).toContain("no 'Claim-2:' line");
    expect(reading.why).not.toContain("'Position:'");
  });

  it('names every missing label in one refusal, so one send-back repairs all', () => {
    const reading = readJuror('evidence', 'Position: amend\n', list);

    expect(reading.read).toBe('uncommitted');
    if (reading.read !== 'uncommitted') throw new Error('unreachable');
    expect(reading.why).toContain("no 'Claim-1:' line");
    expect(reading.why).toContain("no 'Claim-2:' line");
  });

  it('refuses when the first label is the one missing, though the rest committed', () => {
    const reading = readJuror('evidence', 'Claim-1: supported\nClaim-2: refuted\n', list);

    expect(reading.read).toBe('uncommitted');
  });

  it('keeps Claim-1 and Claim-10 apart', () => {
    const reading = readJuror('evidence', 'Claim-10: supported\n', [claim(1)]);

    expect(reading.read).toBe('uncommitted');
  });

  it('answers a juror that wrote nothing as empty, once', () => {
    expect(readJuror('evidence', null, list)).toEqual({
      read: 'empty',
      lens: 'evidence',
      why: 'wrote no file',
    });
  });

  it('reconciles over the first label alone', () => {
    const a = readJuror('a', 'Position: amend\nClaim-1: supported\n', [draft, claim(1)]);
    const b = readJuror('b', 'Position: amend\nClaim-1: refuted\n', [draft, claim(1)]);

    expect(readPanel([a, b])).toEqual({
      panel: 'unanimous',
      position: 'amend',
      lenses: ['a', 'b'],
    });
  });

  it('refuses an empty list rather than committing to nothing', () => {
    expect(() => readJuror('a', 'Position: amend', [])).toThrow('at least one commitment');
  });
});

describe('a list of one reads exactly as the bare commitment', () => {
  const files = [
    null,
    '',
    'Position: amend',
    'Position: maybe',
    'prose only',
    'Position: amend\nPosition: reject',
    'Position: proceed — and Position: proceed',
  ];

  it.each(files)('gives the same reading for %j', (text) => {
    expect(readJuror('x', text, [draft])).toEqual(readJuror('x', text, draft));
  });
});
