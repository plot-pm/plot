// Section 24 of plot-reconcile-scan.sh: a slice heading that names a branch the
// parser did not read. The fixture repository carries REAL plans copied from
// docs/plans/, because the properties under test are about the estate: the five
// slices once lost to the first-heading latch are now READ and no longer
// reported (#1042, 2026-09-28), a value no prefix matches still is, and a plan
// whose empty waves are narrative stays silent. Offline, no git host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const scan = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const PULSE = '2026-08-30-the-pulse-is-an-entity.md';
const OPUS5 = '2026-07-25-opus5-longhorizon-hardening.md';
// One of the 10 plans whose empty waves carry no `Branch:` — narrative, not
// the defect. Never one of the two latched plans above.
const NARRATIVE = '2026-08-20-a-wave-is-a-thing-not-a-label.md';

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const splitSections = (text) => {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^== (\d+)\. /.exec(line);
    if (m) { cur = m[1]; out[cur] = ''; continue; }
    if (cur) out[cur] += line + '\n';
  }
  return out;
};

let tmp, report, sections;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-unread-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);
  for (const name of [PULSE, OPUS5, NARRATIVE]) {
    w(`plans/${name}`, fs.readFileSync(path.join(repoRoot, 'docs', 'plans', name), 'utf8'));
  }
  // A value no configured prefix matches: the other repair, not #1042.
  w('plans/2026-09-28-unreadable.md', `# Unreadable value

## Status

- **State:** Draft
- **Type:** bug

## Slices

### Odd (Branch: feat/not-a-prefix)

Work.
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  sections = splitSections(report);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: section 24 no longer reports the five slices, because the parser reads them', () => {
  // THE FIVE WERE THIS SECTION'S FOUNDING POPULATION, and #1042 removed it.
  // The section reported them because the first-heading latch classified a
  // narrative-opening section as list-shaped and the parser never read its
  // branched headings. The latch went on 2026-09-28, so these five headings are
  // read and there is nothing to report about them.
  //
  // The assertions are inverted rather than deleted: the two real plans are the
  // right fixture either way, and a reader arriving from #1042 finds the case it
  // names. What the section DOES report is asserted by the test below, against
  // the value no prefix matches.
  const s = sections['24'];
  for (const h of [
    'Naming (Branch: docs/the-pulse-has-a-design)',
    'Freeing the word (Branch: feature/the-scan-reads-a-fleet-reading, PR: #600)',
    'Ticking (Branch: feature/a-subscriber-names-its-divisor)',
    'Waiting (Branch: feature/an-agent-waits-instead-of-asking)',
  ]) {
    assert.ok(!s.includes(`${PULSE} — heading '${h}'`), `still reported: ${h}\n${s}`);
  }
  assert.ok(!s.includes(`${OPUS5} — heading 'Recovered (Branch: infra/recover-opus5-hardening, PR: #423)'`), s);
  // And no finding names #1042 as its repair, since that repair has landed.
  const repairs = s.split('\n').filter((l) => l.includes('repair: #1042')).length;
  assert.equal(repairs, 0, s);
});

test('scan: section 24 names the rewrite for a value no prefix matches', () => {
  const s = sections['24'];
  assert.match(s, /2026-09-28-unreadable\.md — heading 'Odd \(Branch: feat\/not-a-prefix\)'/);
  assert.match(s, /rewrite: the value as Branch: <prefix>\/<name>/);
});

test('scan: section 24 is silent for a plan whose empty waves are narrative', () => {
  assert.doesNotMatch(sections['24'], new RegExp(NARRATIVE.replace(/\./g, '\\.')));
});

test('scan: section 24 sits below the blocking marker and gates nothing', () => {
  assert.ok(report.indexOf('== blocking sections end ==') < report.indexOf('== 24. '), 'below the marker');
  const footer = report.trim().split('\n').at(-1);
  // ONE, not six: #1042 removed the five latched findings and left the one
  // heading whose value no configured prefix matches, which is a real finding
  // and the only shape this section still has to report.
  assert.match(footer, /\bunread_headings=1\b/);
  // No unread heading reaches the blocking attention section.
  assert.doesNotMatch(sections['5'], /Branch:/);
});
