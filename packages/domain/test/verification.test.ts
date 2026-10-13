import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { performDecision } from '../src/adapters/performer/perform-fs.js';
import { recordCommitOf } from '../src/adapters/refs/refs-git.js';
import { claimsOf, renderClaims } from '../src/rules/claims.js';
import { fencedLines } from '../src/rules/fences.js';
import { jurorPath, moderationPath } from '../src/rules/panel.js';
import { foldVerification, refutedIssue, verificationBody, verifiedValue } from '../src/rules/verification.js';
import { refutedClaims } from '../src/rules/verification-record.js';
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

describe('verificationBody with every juror refuting', () => {
  it('names no supporting lens', () => {
    const fold = foldVerification(['one'], [{ lens: 'a', text: 'Claim-1: refuted\n' }]);
    if (fold.fold !== 'record') throw new Error('expected a record');
    expect(verificationBody(fold.verdicts)).toBe('- Claim-1 refuted — one — a refuted\n');
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
  it('appends a section after text with no final newline', () => {
    expect(withSection('# P', 'Verification', '- a\n')).toBe('# P\n\n## Verification\n\n- a\n');
  });

  it('appends a missing section and replaces an existing one in place', () => {
    const once = withSection(PLAN, 'Verification', '- a\n');
    expect(once.endsWith('## Verification\n\n- a\n')).toBe(true);
    const twice = withSection(`${once}\n## After\n\nx\n`, 'Verification', '- b\n');
    expect(twice.match(/^## Verification$/gm)).toHaveLength(1);
    expect(twice).toContain('- b');
    expect(twice).not.toContain('- a\n');
    expect(twice).toContain('## After');
  });

  it('skips a fenced ## Verification and a fenced heading inside the section', () => {
    const text = [
      '# P',
      '',
      '## Design',
      '',
      '```markdown',
      '## Verification',
      '',
      '- example',
      '```',
      '',
      'Design text.',
      '',
      '## Verification',
      '',
      '- old',
      '',
      '~~~',
      '## Not a heading',
      '~~~',
      '',
      '## After',
      '',
    ].join('\n');
    const out = withSection(text, 'Verification', '- new\n');
    expect(out).toContain('```markdown\n## Verification\n\n- example\n```\n\nDesign text.');
    expect(out).toContain('## Verification\n\n- new\n\n## After');
    expect(out).not.toContain('- old');
    expect(out).not.toContain('## Not a heading');
  });

  it('appends a section where the only ## Verification is fenced', () => {
    const text = '# P\n\n```\n## Verification\n```\n';
    expect(withSection(text, 'Verification', '- a\n')).toBe(`${text}\n## Verification\n\n- a\n`);
  });

  it('keeps every other heading and every line of the real plan file', () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'the-fleet-verifies-what-it-delivered.md');
    const text = readFileSync(fixture, 'utf8');
    const headings = (t: string) => {
      const lines = t.split('\n');
      const fenced = fencedLines(lines);
      return lines.filter((line, i) => !fenced[i] && /^#{1,6} /.test(line));
    };
    expect(text.split('\n').filter((line) => line === '## Verification')).toHaveLength(1);
    const out = withSection(text, 'Verification', '- Claim-1 supported — x\n');
    expect(headings(out)).toEqual([...headings(text), '## Verification']);
    expect(out.startsWith(text)).toBe(true);
    const again = withSection(out, 'Verification', '- Claim-1 refuted — x\n');
    expect(again.startsWith(text)).toBe(true);
    expect(headings(again)).toEqual(headings(out));
    expect(claimsOf(text)).toEqual(claimsOf(out));
  });
});

describe('fencedLines', () => {
  const flags = (text: string) => fencedLines(text.split('\n')).map((f) => (f ? 1 : 0)).join('');

  it('marks a backtick and a tilde fence, opener and closer included', () => {
    expect(flags('a\n```js\nx\n```\nb\n~~~\ny\n~~~\nc')).toBe('011101110');
  });

  it('closes only on the same character, at least as long, with nothing after it', () => {
    expect(flags('````\n```\n~~~~\n```` x\n`````\nz')).toBe('111110');
  });

  it('opens no fence for a backtick info string holding a backtick, and runs an unclosed fence to the end', () => {
    expect(flags('```a`b\nx\n   ~~~\ny')).toBe('0011');
    expect(flags('    ```\nx')).toBe('00');
  });
});

describe('claimsOf over fences', () => {
  it('reads no heading and no item inside a fence', () => {
    const text = '## Changelog\n\n- one\n\n```\n## Acceptance\n- fake\n```\n\n- two\n';
    expect(claimsOf(text)).toEqual(['one', 'two']);
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

describe('verificationBody with issue notes', () => {
  const fold = foldVerification(['one', 'two'], [{ lens: 'a', text: 'Claim-1: refuted\nClaim-2: refuted\n' }]);
  if (fold.fold !== 'record') throw new Error('expected a record');

  it('ends a refuted line in the issue number or the reason, and leaves a claim with no note alone', () => {
    const notes = new Map([['one', { issue: '1712' }], ['two', { noIssue: 'no Tracker declared;\nread-only — here' }]]);
    expect(verificationBody(fold.verdicts, notes)).toBe(
      '- Claim-1 refuted — one — a refuted — #1712\n- Claim-2 refuted — two — a refuted — no issue: no Tracker declared; read-only - here\n',
    );
    expect(verificationBody(fold.verdicts, new Map([['one', { issue: '7' }]]))).toContain('- Claim-2 refuted — two — a refuted\n');
  });

  it('names the plan, the claim and the lenses in the issue it opens', () => {
    const issue = refutedIssue('p', fold.verdicts[0]!, 'abcdef0123');
    expect(issue.title).toBe('Refuted claim of p: one');
    expect(issue.body).toContain('Claim-1');
    expect(issue.body).toContain('abcdef0');
  });

  it('shortens a long claim in the title and names the supporting lenses in the body', () => {
    const long = 'x'.repeat(100);
    const mixed = foldVerification([long], [
      { lens: 'a', text: 'Claim-1: refuted\n' },
      { lens: 'b', text: 'Claim-1: supported\n' },
    ]);
    if (mixed.fold !== 'record') throw new Error('expected a record');
    const issue = refutedIssue('p', mixed.verdicts[0]!, 'abcdef0123');
    expect(issue.title).toBe(`Refuted claim of p: ${'x'.repeat(79)}…`);
    expect(issue.body).toContain('Refuted by a; b supported.');
    expect(issue.body).toContain(`> ${long}`);
  });

  it.each([
    ['1712', '#1712'],
    ['PROJ-12', 'PROJ-12'],
  ])('round-trips the id %s through the line reader', (id, rendered) => {
    const body = verificationBody(fold.verdicts, new Map([['one', { issue: id }], ['two', { noIssue: 'a — b' }]]));
    expect(body).toContain(`— a refuted — ${rendered}\n`);
    expect(refutedClaims(`# P\n\n## Verification\n\n${body}`)).toEqual([
      { n: 1, claim: 'one', issue: id, noIssue: null },
      { n: 2, claim: 'two', issue: null, noIssue: 'a - b' },
    ]);
  });
});
