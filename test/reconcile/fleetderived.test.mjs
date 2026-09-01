// Contract test for the half of plot-fleet-scan.sh that decides WHICH plans
// exist at all: the plan directory grouped by each plan's declared phase, not
// the symlinks somebody remembered to create.
//
// The scan globbed `docs/plans/active/` and appended a glob over
// `docs/plans/delivered/`, so two hand-maintained facts decided a plan's fate:
// whether it appeared, and which group it landed in. Both are copies of
// something the plan already says about itself in its `Phase:` field, and a
// copy maintained by hand disagrees with its original the moment somebody
// forgets.
//
// Measured 2026-08-18: an agent wrote a plan file directly rather than through
// `/plot-idea`. It parsed `canonical`, carried `Phase: Approved`, named three
// branches in two waves and sat on `origin/main` — and every unscoped scan
// reported 12 plans without it, while two agents were already working its
// branches. The failure is silent in the direction that matters: the scan does
// not say "one plan is unindexed", it says nothing at all and its footer count
// is simply lower than reality. It was misdiagnosed three times as a board
// defect before anyone looked at the index.
//
// THE SECOND DIRECTION IS THE ONE PEOPLE FORGET, and it has its own test
// below. A test that only proves an unlinked plan appears would pass on an
// implementation that still lets `active/` override the file — the link would
// simply be additive. Proving a link CANNOT resurrect a delivered plan is what
// pins the phase as the single source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:MM` for a moment `hoursAgo` in the past, in LOCAL time. */
function stampHoursAgo(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * 3600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * A plan file body.
 *
 * `delivered` writes a `Delivered:` record — a terminal plan needs one to fall
 * inside the rolling 24 h window at all ("no date, no row").
 */
function planBody({ title, phase, branch, delivered }) {
  const record = delivered ? `- **Delivered:** ${delivered}\n` : '';
  return `# ${title}

## Status

- **Phase:** ${phase}
- **Type:** feature
${record}
## Branches

### Work

- \`${branch}\` — do the thing
`;
}

/**
 * A sandbox repo with an origin, so the scan takes its normal ref-reading path
 * rather than the worktree fallback.
 *
 * `plans` is a list of `{ name, title, phase, branch, delivered, link }`.
 * `link` chooses what the index says, INDEPENDENTLY of the phase — that
 * independence is the whole point of this suite:
 *   'active'     — a symlink in `docs/plans/active/`
 *   'delivered'  — a symlink in `docs/plans/delivered/`
 *   'none'       — no symlink anywhere
 */
function makeRepo(plans) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-derived-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, 'repo');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
`,
  );

  const dir = path.join(repo, 'docs', 'plans');
  fs.mkdirSync(path.join(dir, 'active'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'delivered'), { recursive: true });

  for (const p of plans) {
    fs.writeFileSync(path.join(dir, p.name), planBody(p));
    if (p.link && p.link !== 'none') {
      // Slug-named, the way plot writes them: the index alias drops the date
      // prefix, which is exactly why the scan must not take its display name
      // from the link.
      const slug = p.name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      fs.symlinkSync(path.join('..', p.name), path.join(dir, p.link, slug));
    }
  }

  // Keep the index directories present in the ref even when nothing is linked
  // there — an empty directory is not a tree entry, and a fixture that silently
  // dropped `active/` would prove the wrong thing.
  fs.writeFileSync(path.join(dir, 'active', '.gitkeep'), '');
  fs.writeFileSync(path.join(dir, 'delivered', '.gitkeep'), '');

  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return { tmp, repo };
}

function scanJson(cwd, ...args) {
  return JSON.parse(
    execFileSync('bash', [scan, '--json', '--offline', ...args], { encoding: 'utf8', cwd }),
  );
}

test('a plan with no symlink appears', () => {
  // The original incident, reduced: an Approved plan that nobody linked. Under
  // the old glob it was invisible and its count was simply lower than reality.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-linked.md', title: 'Linked plan', phase: 'Approved',
      branch: 'feature/linked-work', link: 'active',
    },
    {
      name: '2026-08-19-unlinked.md', title: 'Unlinked plan', phase: 'Approved',
      branch: 'feature/unlinked-work', link: 'none',
    },
  ]);
  try {
    // The precondition that makes the assertion mean something: the index
    // really does hold only one of the two.
    assert.deepEqual(
      fs.readdirSync(path.join(repo, 'docs', 'plans', 'active'))
        .filter((f) => f.endsWith('.md')),
      ['linked.md'],
      'the fixture must leave the second plan unlinked — otherwise this proves nothing',
    );

    const out = scanJson(repo);
    assert.equal(out.summary.plans, 2, 'both plans must be counted');
    assert.deepEqual(
      out.plans.map((p) => p.file).sort(),
      ['2026-08-19-linked.md', '2026-08-19-unlinked.md'],
      'and the unlinked plan must be named specifically',
    );

    // Resolved to its CONTENT, not merely counted: an enumeration that found
    // the file but never parsed it would report a plan with no branches, which
    // is invisibility wearing a row.
    const unlinked = out.plans.find((p) => p.file === '2026-08-19-unlinked.md');
    assert.equal(unlinked.phase, 'approved');
    assert.deepEqual(
      unlinked.waves.flatMap((w) => w.branches.map((b) => b.branch)),
      ['feature/unlinked-work'],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a symlink pointing at a delivered plan does not resurrect it', () => {
  // THE DIRECTION PEOPLE FORGET. `/plot-deliver` moves the symlink from
  // `active/` to `delivered/`; a delivery that edits the phase and forgets the
  // link leaves an ACTIVE link over a delivered plan. If `active/` still had
  // any say, this plan would read as live work — and it would be eligible,
  // because its branch is open.
  //
  // The `Delivered:` record is deliberately OUTSIDE the 24 h window, so the
  // only thing that could put this plan on the pulse is the stale link.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-live.md', title: 'Live plan', phase: 'Approved',
      branch: 'feature/live-work', link: 'active',
    },
    {
      name: '2026-08-19-finished.md', title: 'Finished plan', phase: 'Delivered',
      branch: 'feature/finished-work', link: 'active',
      delivered: stampHoursAgo(72),
    },
  ]);
  try {
    // Both plans are linked into `active/`. The old glob would have returned
    // two live plans here.
    assert.equal(
      fs.readdirSync(path.join(repo, 'docs', 'plans', 'active'))
        .filter((f) => f.endsWith('.md')).length,
      2,
      'the fixture must link BOTH plans as active — the stale link is the test',
    );

    const out = scanJson(repo);
    assert.deepEqual(
      out.plans.map((p) => p.file),
      ['2026-08-19-live.md'],
      'a stale active link must not put a delivered plan back on the pulse',
    );
    assert.equal(out.summary.plans, 1);

    // And nothing under it may be offered as claimable work: `--next` is what
    // a dispatcher asks, and answering with a finished plan's branch would send
    // an agent at work somebody already did.
    const next = execFileSync('bash', [scan, '--next', '--offline'], {
      encoding: 'utf8', cwd: repo,
    }).trim();
    assert.equal(next, 'feature/live-work', '--next must name only the live plan’s branch');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a delivered plan inside the window still appears, with no symlink at all', () => {
  // The window itself is unchanged — this pins that deriving the GROUP did not
  // quietly change WHICH delivered plans are in it. The plan has no link in
  // either index, so the old enumeration could not have found it by any path,
  // and the mtime pre-filter that used to gate the delivered group is gone with
  // the directory it read.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-recent.md', title: 'Recently delivered', phase: 'Delivered',
      branch: 'feature/recent-work', link: 'none',
      delivered: stampHoursAgo(3),
    },
    {
      name: '2026-08-19-old.md', title: 'Long delivered', phase: 'Delivered',
      branch: 'feature/old-work', link: 'none',
      delivered: stampHoursAgo(72),
    },
  ]);
  try {
    const out = scanJson(repo);
    assert.deepEqual(
      out.plans.map((p) => p.file),
      ['2026-08-19-recent.md'],
      'the rolling 24 h window must still decide which delivered plans show',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a released plan is terminal too', () => {
  // `released` follows `delivered`, and so do `rejected` and `superseded`: they
  // are outcomes, not work, and `/plot-deliver` files all of them under the
  // delivered index (issue #33). Grouping by phase has to carry that rule
  // across, or 46 released plans in this repo would arrive as live work.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-shipped.md', title: 'Shipped plan', phase: 'Released',
      branch: 'feature/shipped-work', link: 'active',
      delivered: stampHoursAgo(72),
    },
    {
      name: '2026-08-19-rejected.md', title: 'Rejected plan', phase: 'Rejected',
      branch: 'feature/rejected-work', link: 'active',
      delivered: stampHoursAgo(72),
    },
    {
      name: '2026-08-19-open.md', title: 'Open plan', phase: 'Draft',
      branch: 'feature/open-work', link: 'none',
    },
  ]);
  try {
    const out = scanJson(repo);
    assert.deepEqual(
      out.plans.map((p) => p.file), ['2026-08-19-open.md'],
      'terminal phases must leave the pulse regardless of where they are linked',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty estate is a complete answer, not a partial one', () => {
  // THE FIRST THING AN INSTALLED BOARD DOES. A new user has zero plans, and
  // this branch used to `exit 0` before the emitter — so `--json` got human
  // prose and `--stream` got no terminal `pulse` line at all. The board's
  // contract makes a missing `pulse` line mean *the scan did not finish*, so a
  // complete answer was reported as a scan failure, every pulse, forever.
  //
  // Measured 2026-08-28 against a board installed from npm: "fleet scan ended
  // without a terminal pulse line", `ready:false`, five pulses running.
  const { tmp, repo } = makeRepo([]);
  try {
    const out = scanJson(repo);
    assert.deepEqual(out.plans, [], 'an empty estate reports no plans');
    assert.equal(out.summary.plans, 0, 'and says so in the summary');
    // The keys a consumer indexes. An empty estate must produce the SAME
    // document shape as a populated one — a second shape is a second thing to
    // keep in step, which is how the original defect was written.
    for (const key of ['main', 'plans', 'summary']) {
      assert.ok(key in out, `an empty estate still carries \`${key}\``);
    }

    // The stream's terminal line is the whole contract: it is what says the
    // scan finished. A closed pipe does not, because a killed scan closes it
    // too.
    //
    // ITS KIND IS `reading`, renamed from `pulse` with the type. The CONTRACT is
    // unchanged — a consumer that sees no terminal line still reads the scan as
    // unfinished, which is what `fleet.ts` throws on — and only the word moved,
    // in step with `FleetScanLineSchema`'s literal and the scan's own printf.
    const streamed = execFileSync('bash', [scan, '--stream', '--offline'], {
      encoding: 'utf8', cwd: repo,
    }).trim().split('\n');
    const last = JSON.parse(streamed[streamed.length - 1]);
    assert.equal(last.kind, 'reading', 'the stream ends with its terminal reading line');

    // The human path is UNCHANGED and deliberately so: a person reading an
    // empty estate wants the sentence, not an empty JSON document.
    const human = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
    assert.match(human, /No plans found/, 'a person still gets the sentence');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a file with no Phase: field is not a plan', () => {
  // The rule had to be DECIDED rather than inherited. The old glob excluded
  // notes by ACCIDENT — nobody had linked them — so enumerating the directory
  // without a rule trades a list that is wrongly short for one that is wrongly
  // long. Measured in this repo 2026-08-19: 64 `.md` files in the plan
  // directory, 62 plans and two notes carrying no `Phase:` field at all.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-real.md', title: 'Real plan', phase: 'Approved',
      branch: 'feature/real-work', link: 'none',
    },
  ]);
  try {
    // A note, written the way the two real ones are: prose in the plan
    // directory, with a heading and no `## Status` section.
    fs.writeFileSync(
      path.join(repo, 'docs', 'plans', 'open-questions.md'),
      '# Open questions\n\nNotes on a thing. No phase, because this is not a plan.\n',
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'a note that is not a plan');
    git(repo, 'push', '-q', 'origin', 'main');

    const out = scanJson(repo);
    assert.deepEqual(
      out.plans.map((p) => p.file), ['2026-08-19-real.md'],
      'a phase-less file must not be reported as a plan',
    );
    assert.equal(out.summary.plans, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an unrecognised phase value still counts as a plan', () => {
  // The other side of the same rule, and the direction that matters more.
  // `UNKNOWN` means the file DECLARED a phase whose value the parser did not
  // recognise — a typo, or a phase word this version predates. That is a plan
  // with a bad field, and hiding it for a misspelling would rebuild the
  // invisibility this change removes, one level down where it is harder to see
  // than a missing symlink was.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-typo.md', title: 'Typo plan', phase: 'Aproved',
      branch: 'feature/typo-work', link: 'none',
    },
  ]);
  try {
    const out = scanJson(repo);
    assert.equal(out.summary.plans, 1, 'a misspelled phase must not hide the plan');
    assert.equal(out.plans[0].phase, 'UNKNOWN', 'and the bad value must be reported as such');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the index directories are not enumerated as plans', () => {
  // `active/` and `delivered/` live INSIDE the plan directory by default, and
  // their symlinks resolve to files already enumerated. A recursive read would
  // report every linked plan twice — the count would roughly double on any
  // repo with a maintained index, which is the loudest possible regression and
  // therefore worth a test that cannot be argued with.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-one.md', title: 'Plan one', phase: 'Approved',
      branch: 'feature/one-work', link: 'active',
    },
    {
      name: '2026-08-19-two.md', title: 'Plan two', phase: 'Approved',
      branch: 'feature/two-work', link: 'active',
    },
  ]);
  try {
    const out = scanJson(repo);
    assert.equal(out.summary.plans, 2, 'a linked plan must be counted once, not twice');
    assert.deepEqual(
      out.plans.map((p) => p.file).sort(),
      ['2026-08-19-one.md', '2026-08-19-two.md'],
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the plan is named by its dated file, not by the index alias', () => {
  // Slug-named symlinks drop the date prefix, so the display name is a place
  // the two sources could still disagree after the grouping stopped depending
  // on them. Enumerating `$PLAN_DIR` directly means the dated name is the only
  // one available — asserted so a later change that reintroduces link
  // resolution cannot quietly rename every plan.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-named.md', title: 'Named plan', phase: 'Approved',
      branch: 'feature/named-work', link: 'active',
    },
  ]);
  try {
    const out = scanJson(repo);
    assert.deepEqual(out.plans.map((p) => p.file), ['2026-08-19-named.md']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a named slug still resolves through the index', () => {
  // `active/` KEEPS WORKING — this wave stops anything depending on it being
  // right, and removes nothing. A slug is the one place the index's stable,
  // undated names are the QUESTION rather than a copy of an answer:
  // `plot-fleet-scan.sh plot-sprint-support` names a symlink, and every caller
  // that passes a slug got it from one.
  const { tmp, repo } = makeRepo([
    {
      name: '2026-08-19-slugged.md', title: 'Slugged plan', phase: 'Approved',
      branch: 'feature/slugged-work', link: 'active',
    },
    {
      name: '2026-08-19-other.md', title: 'Other plan', phase: 'Approved',
      branch: 'feature/other-work', link: 'active',
    },
  ]);
  try {
    const out = scanJson(repo, 'slugged');
    assert.deepEqual(
      out.plans.map((p) => p.file), ['2026-08-19-slugged.md'],
      'a slug must select exactly its own plan',
    );
    // And it must print the dated filename rather than the alias it matched.
    assert.equal(out.summary.plans, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an empty plan directory says which directory it read', () => {
  // The message named `$ACTIVE_DIR` while the scan globbed it. Pointing a
  // reader at the index now would send them to look for the cause of an empty
  // list in a directory nothing consults.
  const { tmp, repo } = makeRepo([]);
  try {
    const prose = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
    assert.match(prose, /No plans found in docs\/plans\//);
    assert.match(prose, /plans=0/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the worktree fallback derives the same way', () => {
  // A repo with no remote answers from its checkout, and that path is a second
  // enumeration — it globbed `active/` and ran the mtime pre-filter over
  // `delivered/`. Deriving in one mode and not the other would make the fix
  // depend on whether an operator had a remote configured.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-derived-solo-'));
  try {
    const repo = path.join(tmp, 'solo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'Plot Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(
      path.join(repo, 'CLAUDE.md'),
      '# Sandbox\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n' +
        '- **Active index:** docs/plans/active/\n' +
        '- **Delivered index:** docs/plans/delivered/\n',
    );
    const dir = path.join(repo, 'docs', 'plans');
    fs.mkdirSync(path.join(dir, 'active'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '2026-08-19-solo.md'),
      planBody({
        title: 'Solo plan', phase: 'Approved', branch: 'feature/solo-work',
      }),
    );
    // Linked into `active/` while its phase says otherwise — the stale link
    // must be as inert here as it is in ref mode.
    fs.writeFileSync(
      path.join(dir, '2026-08-19-gone.md'),
      planBody({
        title: 'Gone plan', phase: 'Delivered', branch: 'feature/gone-work',
        delivered: stampHoursAgo(72),
      }),
    );
    fs.symlinkSync(path.join('..', '2026-08-19-gone.md'), path.join(dir, 'active', 'gone.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'solo plans');

    const out = scanJson(repo);
    assert.equal(out.plan_source, 'worktree', 'the fallback must be declared');
    assert.deepEqual(
      out.plans.map((p) => p.file), ['2026-08-19-solo.md'],
      'the worktree path must derive from the phase too',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
