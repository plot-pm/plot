import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { performDecision } from '../src/adapters/performer/perform-fs.js';
import { recordCommitOf } from '../src/adapters/refs/refs-git.js';
import { claimsOf, renderClaims } from '../src/rules/claims.js';
import { jurorPath, moderationPath } from '../src/rules/panel.js';
import { foldVerification, verificationBody, verifiedValue } from '../src/rules/verification.js';
import { withRecord, withSection } from '../src/workflows/rendering.js';

const PLAN = `# P

## Status

- **State:** Delivered
- **Delivered:** 2026-10-05, T

## Changelog

- First change
  continued here.
- Second change.

## Acceptance

- Accept one.
`;

describe('claimsOf and renderClaims', () => {
  it('numbers changelog entries then acceptance items, joining continuations', () => {
    expect(claimsOf(PLAN)).toEqual(['First change continued here.', 'Second change.', 'Accept one.']);
  });

  it('renders "<n>. <claim>" and never a Claim-<n> line', () => {
    const out = renderClaims(claimsOf(PLAN));
    expect(out.split('\n').filter(Boolean)[0]).toBe('1. First change continued here.');
    expect(/^Claim-\d+:/m.test(out)).toBe(false);
  });
});

describe('panel prefix', () => {
  it('puts the prefix before the lens and before panel.md', () => {
    expect(jurorPath('s', 'a', 'verify-')).toBe('.plot/panels/s/verify-a.md');
    expect(moderationPath('s', 'verify-')).toBe('.plot/panels/s/verify-panel.md');
    expect(jurorPath('s', 'a')).toBe('.plot/panels/s/a.md');
  });
});

describe('foldVerification', () => {
  const claims = ['one', 'two'];
  const file = (lens: string, text: string | null) => ({ lens, text });

  it('supports a claim every juror supported', () => {
    const fold = foldVerification(claims, [
      file('a', 'Claim-1: supported\nClaim-2: supported\n'),
      file('b', 'Claim-1: supported\nClaim-2: supported\n'),
    ]);
    expect(fold.fold).toBe('record');
    if (fold.fold === 'record') expect(fold.verdicts.map((v) => v.verdict)).toEqual(['supported', 'supported']);
  });

  it('refutes a claim one juror refuted', () => {
    const fold = foldVerification(claims, [
      file('a', 'Claim-1: supported\nClaim-2: supported\n'),
      file('b', 'Claim-1: supported\nClaim-2: refuted\n'),
    ]);
    if (fold.fold !== 'record') throw new Error('expected a record');
    expect(fold.verdicts[1]).toMatchObject({ verdict: 'refuted', refuted: ['b'], supported: ['a'] });
  });

  it('refuses every missing line and answers no verdict', () => {
    const fold = foldVerification(claims, [
      file('a', 'Claim-1: supported\nClaim-2: supported\n'),
      file('b', 'Claim-1: supported\n'),
      file('c', null),
    ]);
    expect(fold.fold).toBe('refused');
    if (fold.fold === 'refused') {
      expect(fold.refusals.map((r) => `${r.label}:${r.lens}`)).toContain('Claim-2:b');
      expect(fold.refusals.some((r) => r.lens === 'c')).toBe(true);
    }
  });

  it('refuses a fold with no juror', () => {
    expect(foldVerification(claims, []).fold).toBe('refused');
  });
});

describe('verifiedValue and verificationBody', () => {
  const fold = foldVerification(['one', 'two'], [
    { lens: 'a', text: 'Claim-1: supported\nClaim-2: supported\n' },
    { lens: 'b', text: 'Claim-1: supported\nClaim-2: refuted\n' },
  ]);
  if (fold.fold !== 'record') throw new Error('expected a record');

  it('renders the record value with seven-character commits and the tally', () => {
    expect(
      verifiedValue(
        { today: '2026-10-12', deliveredOn: '2026-10-05', delivery: 'aaaaaaaaaa', judged: 'bbbbbbbbbb', tools: 'cccccccccc' },
        fold.verdicts,
      ),
    ).toBe('2026-10-12, delivery 2026-10-05 at aaaaaaa, judged at bbbbbbb with tools at ccccccc, 1 supported, 1 refuted');
  });

  it('renders one line per claim naming the lenses', () => {
    expect(verificationBody(fold.verdicts)).toBe(
      '- Claim-1 supported — one — 2 of 2 (a, b)\n- Claim-2 refuted — two — b refuted; a supported\n',
    );
  });
});

describe('withRecord replace mode', () => {
  it('overwrites a filled line and keeps one', () => {
    const once = withRecord(PLAN, 'Verified', 'first', 'replace').text;
    const twice = withRecord(once, 'Verified', 'second (a.b)', 'replace').text;
    expect(twice.match(/\*\*Verified:\*\*/g)).toHaveLength(1);
    expect(twice).toContain('second (a.b)');
    expect(twice).not.toContain('first');
  });

  it('appends instead of overwriting without the mode', () => {
    const once = withRecord(PLAN, 'Verified', 'first').text;
    const twice = withRecord(once, 'Verified', 'second').text;
    expect(twice.match(/\*\*Verified:\*\*/g)).toHaveLength(2);
  });
});

describe('withSection and the plan-section write', () => {
  it('appends a missing section and replaces an existing one in place', () => {
    const once = withSection(PLAN, 'Verification', '- a\n');
    expect(once.endsWith('## Verification\n\n- a\n')).toBe(true);
    const twice = withSection(`${once}\n## After\n\nx\n`, 'Verification', '- b\n');
    expect(twice.match(/^## Verification$/gm)).toHaveLength(1);
    expect(twice).toContain('- b');
    expect(twice).not.toContain('- a\n');
    expect(twice).toContain('## After');
  });

});

describe('recordCommitOf', () => {
  const log = ['@@aaaaaaa1', '+- **Verified:** 2026-10-12, x', '@@bbbbbbb2', '+- **Delivered:** 2026-10-05, T', '@@ccccccc3', '+- **Delivered:** <!-- when -->'].join('\n');

  it('answers the newest commit that added a filled line', () => {
    expect(recordCommitOf(log, 'Delivered')).toBe('bbbbbbb2');
    expect(recordCommitOf(log, 'Verified')).toBe('aaaaaaa1');
  });

  it('answers null where only a placeholder was added', () => {
    expect(recordCommitOf('@@abcdef1\n+- **Delivered:** <!-- when -->', 'Delivered')).toBeNull();
    expect(recordCommitOf('', 'Delivered')).toBeNull();
  });
});

describe('the plan-section write', () => {
  it('lands in the file and reports it once', () => {
    const root = mkdtempSync(join(tmpdir(), 'plan-section-'));
    try {
      writeFileSync(join(root, 'p.md'), PLAN);
      const decision = { writes: [{ kind: 'plan-section', file: 'p.md', heading: 'Verification', body: '- a\n' }] };
      const report = performDecision({ root }, decision as never);
      expect(report.written).toEqual(['p.md']);
      expect(readFileSync(join(root, 'p.md'), 'utf8')).toContain('## Verification');
      expect(performDecision({ root }, decision as never).written).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
