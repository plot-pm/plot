import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KIND_ICON,
  KIND_LABEL,
  SESSION_ID_CHARS,
  releaseVersion,
  shortSessionId,
  tupleFromAgent,
  tupleFromBuild,
  tupleFromIssue,
  tupleFromPlan,
  tupleFromRow,
} from '../../src/app/lib/tuple-row.js';
import {
  AgentRowSchema, IssueRowSchema, RowKindSchema,
  type AgentRow, type IssueRow, type RowKind,
} from '../../src/contract/schema.js';
import { rowKind, rowsFromPulse, RELEASE_BRANCH } from '../../src/server/fleet.js';
import type { FleetPulse } from '../../src/contract/schema.js';

/**
 * A ROW IS A TUPLE — the shape half.
 *
 * The plan this suite belongs to lists twelve assertions, and they divide by
 * what can settle them. Everything here is DATA: which slots a kind fills, what
 * each slot holds, which clock an age names, and where the kind is decided. The
 * DOM half — that the kind is visible without hovering, that a name with no URL
 * is not an anchor, that a PR row renders three separate links — is in
 * `test/integration/tuple-row.browser.test.ts`, because those are claims about
 * what a page renders and a projection cannot prove them.
 */
const row = (over: Partial<AgentRow> = {}): AgentRow => AgentRowSchema.parse({
  repo: 'plot', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-20-a-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you',
  ageMinutes: 30, note: '', ...over,
});

const issue = (over: Partial<IssueRow> = {}): IssueRow => IssueRowSchema.parse({
  number: 228, title: 'Fleet scan asks the host once per branch',
  url: 'https://host/issues/228', ageMinutes: 1440, ...over,
});

describe('the contract carries all seven kinds', () => {
  it('names exactly the seven, and no eighth', () => {
    // The SHAPE rather than an inventory of what exists: four of the seven have
    // no row today and are named anyway, because a shape that admits only
    // today's kinds has to be reopened for each new one — which is how this
    // board arrived at three row components and two grids.
    expect([...RowKindSchema.options].sort()).toEqual(
      ['agent', 'branch', 'build', 'plan', 'pr', 'release', 'ticket']);
  });

  it('gives every kind a word and a glyph', () => {
    // TWO CHANNELS, and the word is the one that matters: recognition must not
    // DEPEND on decoding a symbol. The defect this replaces was a kind stated
    // only in a tooltip.
    for (const kind of RowKindSchema.options) {
      expect(KIND_LABEL[kind], kind).toBeTruthy();
      expect(KIND_ICON[kind], kind).toBeTruthy();
    }
  });

  it('defaults an older pulse to branch rather than to nothing', () => {
    // Every row this board has ever emitted from a pulse IS a branch row, so
    // the default is the truth about payloads that predate the field, not a
    // placeholder standing in for one.
    const old = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'p', wave: 'w', state: 'wip',
      group: 'quiet', ageMinutes: 1, note: '',
    });
    expect(old.kind).toBe('branch');
  });

  it('states a ticket kind on an issue row too', () => {
    // Every one of the seven arrives the same way, which is what lets one row
    // component read slot 2 from the data rather than from its call site.
    expect(issue().kind).toBe('ticket');
    expect(IssueRowSchema.parse({ number: 1, title: 't' }).kind).toBe('ticket');
  });
});

describe('the server decides the kind, and the renderer reads it', () => {
  const pulse: FleetPulse = {
    main: 'main', head: 'abc', plans: [{
      file: '2026-08-20-a-plan.md', phase: 'approved',
      waves: [{
        name: 'Shaped', verdict: 'eligible',
        branches: [
          { branch: 'feature/plain', state: 'open', deferred: false },
          { branch: 'feature/clashing', state: 'wip', deferred: false,
            conflicts: ['a.ts'], conflicts_known: true },
        ],
      }],
    }],
    summary: { plans: 1, waves: 1, branches: 2, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
  } as never;
  const ages = new Map<string, number | null>([
    ['feature/plain', 10], ['feature/clashing', 20],
  ]);
  const pr = (over: Record<string, unknown> = {}) => ({
    number: 57, head: 'feature/plain', state: 'OPEN', draft: false, checks: 'green',
    mergeable: 'mergeable', review: '', url: 'https://host/pr/57', ...over,
  }) as never;

  it('calls a branch with an open PR a pr — the normal case, not an edge', () => {
    // Measured 2026-08-20: 67 of 80 live rows carry BOTH a branch and a PR and
    // only 13 a branch alone. So `branch` and `pr` are not two kinds of thing —
    // they are two roles one row can be in, and `kind` picks the one the reader
    // is deciding about.
    const rows = rowsFromPulse(pulse, ages, 'plot', 30, new Map([['feature/plain', pr()]]));
    expect(rows.find((r) => r.branch === 'feature/plain')!.kind).toBe('pr');
  });

  it('calls a CONFLICTING branch a branch, even with an open PR', () => {
    // No PR resolves a conflict: the reader has to go to the branch and rebase.
    // This is the one arm that overrides an open PR, and it is why the kind
    // cannot be `row.pr ? 'pr' : 'branch'`.
    const prs = new Map([['feature/clashing', pr({ head: 'feature/clashing' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', 30, prs);
    expect(rows.find((r) => r.branch === 'feature/clashing')!.kind).toBe('branch');
  });

  it('calls a branch with no PR a branch', () => {
    const rows = rowsFromPulse(pulse, ages, 'plot', 30);
    expect(rows.find((r) => r.branch === 'feature/plain')!.kind).toBe('branch');
  });

  it('marks the release branch, which reaches the board as one more open PR', () => {
    // THE ROW NOBODY SHOULD MERGE BY REFLEX. It arrives through the planless
    // loop — no plan names it — and without the mark it renders as an ordinary
    // PR awaiting review. This is the case a renderer-side derivation would
    // have to hardcode or misclassify, which is the whole argument for the
    // field.
    const prs = new Map([['changeset-release/main',
      pr({ head: 'changeset-release/main', number: 300 })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', 30, prs);
    expect(rows.find((r) => r.branch === 'changeset-release/main')!.kind).toBe('release');
  });

  it('keeps the release arm above the PR arm, whatever else is true', () => {
    // Ordering, stated directly: a conflicting release is still a release. The
    // mark exists to stop a reflex merge, so it cannot be outranked by an arm
    // that would claim the row for another reason.
    expect(rowKind('changeset-release/main', true, true)).toBe('release');
    expect(rowKind('changeset-release/main', false, false)).toBe('release');
    expect(RELEASE_BRANCH.test('changeset-release/main')).toBe(true);
    // And it does not catch a branch that merely mentions the word.
    expect(RELEASE_BRANCH.test('feature/changeset-release-notes')).toBe(false);
  });

  it('never re-decides the kind in the projection', () => {
    // The judgement is the SERVER's, made once where it holds both facts. A
    // projection forming a second opinion is the defect the field exists to
    // prevent: only some of the facts arrive on the client.
    //
    // A row whose fields all say `pr` but whose kind says `branch` must render
    // as a branch — which is exactly what a re-derivation would get wrong.
    const disagreeing = row({
      kind: 'branch',
      pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'green' },
    });
    const tuple = tupleFromRow(disagreeing);
    expect(tuple.kind).toBe('branch');
    expect(tuple.name.label).toBe('feature/x');
  });

  it('reads a row with NO kind at all as a branch', () => {
    // `RowKindSchema.default('branch')` fills the field for every row that
    // comes through the parser, and that is most of them. It is not all of
    // them: a browser suite that fulfils `/api/fleet` from a literal serves
    // rows the schema never saw, and twelve of this estate's suites do exactly
    // that. So the projection carries the same fallback the contract states.
    //
    // MEASURED AS A REGRESSION rather than imagined. `icon` and `kindLabel`
    // each guarded against an unknown kind while `kind` itself passed the raw
    // value through, so a fieldless row rendered a branch's glyph and a
    // branch's word beside `data-tuple-kind` and `data-kind` attributes that
    // were ABSENT — a row that looks right and cannot be found. Two browser
    // tests timed out on it, which reads like a hang rather than a defect.
    const fieldless = { ...row(), kind: undefined } as unknown as AgentRow;
    const t = tupleFromRow(fieldless);
    expect(t.kind).toBe('branch');
    expect(t.kindLabel).toBe('Branch');
    expect(t.icon).toBe(KIND_ICON.branch);
    // And the NAME is the branch's, which is the arm the fallback has to reach:
    // a fallback that fixed only the label would leave a fieldless row taking
    // whichever arm `undefined` happened to miss.
    expect(t.name.what).toBe('branch');
  });

  it('has no kind derivation in the client at all', () => {
    // A STRUCTURAL assertion, because the rule is about where code lives rather
    // than what one input produces. The projection may READ `row.kind`; it may
    // not sniff `row.pr`, `row.planFile` or the branch name to work one out.
    // The release branch name in particular is matched in the server and
    // nowhere else — a second copy on the client would be the defect the field
    // exists to prevent.
    //
    // COMMENTS ARE STRIPPED FIRST, and that distinction is the whole reason
    // this assertion is worth anything. The projection DISCUSSES the release
    // convention at length — it has to, since `releaseVersion` exists precisely
    // because the branch name carries the base and not the version — and a
    // match against the raw file would fail on the prose that explains why the
    // code does not do the thing. A test that cannot tell a mention from a
    // match is a test that gets deleted the first time it is wrong.
    const src = readFileSync(
      new URL('../../src/app/lib/tuple-row.ts', import.meta.url), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/changeset-release/);
    // And the stripping actually removed something, so the assertion above is
    // about code rather than about an empty string.
    expect(src).toMatch(/changeset-release/);
    expect(code.length).toBeLessThan(src.length / 2);
  });
});

describe('slot 3 is the item and slot 4 is the vehicle', () => {
  it('gives a PR row three separate links to three destinations', () => {
    // A PR names three things — the PR, its plan, its branch — and all three are
    // already on the row: measured on the live pulse, a PR row carries `plan`,
    // `planFile`, `branch`, `branchUrl` and `pr`. Nothing new is fetched; what
    // was missing is that only some rendered, and only one was a link.
    const t = tupleFromRow(row({
      kind: 'pr',
      pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'conflicts' },
      branchUrl: 'https://host/tree/feature/x',
    }));
    expect(t.name).toMatchObject({ what: 'pr', label: '57', href: 'https://host/pr/57' });
    expect(t.links.map((l) => l.what)).toEqual(['plan', 'branch']);
    // THREE DESTINATIONS, all different. Interchangeable words are what the
    // association requirement exists to prevent.
    const targets = [t.name.href, ...t.links.map((l) => l.href)];
    expect(new Set(targets).size).toBe(3);
  });

  it('leads a branch row with the branch and links only its plan', () => {
    // A branch's name IS the branch, so its artifact slot holds the plan that
    // governs it — and nothing else. "Which fact leads" is answered by
    // construction rather than by a table of cases per kind.
    const t = tupleFromRow(row({ kind: 'branch', branchUrl: 'https://host/tree/feature/x' }));
    expect(t.name.what).toBe('branch');
    expect(t.links.map((l) => l.what)).toEqual(['plan']);
  });

  it('gives a planless branch NO artifact link rather than an empty one', () => {
    // Nothing renders as nothing. An empty slot is not a dead control — the
    // rule this board already applies to a PR cell with no PR.
    const t = tupleFromRow(row({ kind: 'branch', plan: '', planFile: '' }));
    expect(t.links).toEqual([]);
  });

  it('renders a name with no address as text, never as an invented link', () => {
    // `href: ''` is the projection's way of saying *no honest address exists* —
    // a merged branch whose remote page is gone, or an origin whose host shape
    // the board does not recognise. A fabricated URL is indistinguishable from
    // a real one until it 404s.
    const merged = tupleFromRow(row({ kind: 'branch', state: 'merged', branchUrl: '' }));
    expect(merged.name.href).toBe('');
    // And a plan with no file resolves to no address either, by the same rule.
    const idea = tupleFromRow(row({ kind: 'branch', planFile: '' }));
    expect(idea.links[0]).toMatchObject({ what: 'plan', href: '' });
  });

  it('says what each link points at, so three do not read as three words', () => {
    // The association requirement, as data: a reader must know what they are
    // about to open BEFORE they click.
    const t = tupleFromRow(row({
      kind: 'pr',
      pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'green' },
      branchUrl: 'https://host/tree/feature/x',
    }));
    for (const link of t.links) expect(link.what).toBeTruthy();
  });
});

describe('a release is its own kind, and it carries only a mark', () => {
  const release = row({
    kind: 'release', plan: '', planFile: '', branch: 'changeset-release/main',
    branchUrl: 'https://host/tree/changeset-release/main',
    pr: { number: 300, url: 'https://host/pr/300', draft: false, state: 'none' },
  });

  it('renders as a release, distinguishable from an ordinary PR', () => {
    expect(tupleFromRow(release).kindLabel).toBe('Release');
    expect(tupleFromRow(release).kind).toBe('release');
  });

  it('names its PR where no version is known, rather than inventing a tag', () => {
    // Changesets names the branch after the BASE, not the version, so most
    // release rows honestly know no version. Deriving `2.7.0` would mean summing
    // pending bumps — *what would this ship* — the question the plan refuses to
    // answer on a board, because it makes the board where release decisions are
    // prepared.
    expect(releaseVersion(release)).toBe('');
    expect(tupleFromRow(release).name.label).toBe('300');
    // And where a version IS on the row, it leads — the version is what a
    // reader decides about, and the PR is how it gets there.
    expect(tupleFromRow({ ...release, plan: '2.7.0' }).name.label).toBe('2.7.0');
  });

  it('carries no action of its own — the tuple says what a row IS', () => {
    // A menu entry offering to release would put an outward-facing act on a
    // board, and this repo cuts a release only on an explicit request. The
    // projection produces slots and no items at all; the browser suite asserts
    // the rendered menu offers none.
    expect(Object.keys(tupleFromRow(release))).toEqual(
      ['kind', 'icon', 'kindLabel', 'status', 'age', 'name', 'links']);
  });
});

describe('a ticket carries its age, and its number is the artifact', () => {
  it('leads with the title and links the tracker', () => {
    // The title is what a reader decides about; the number is where they go to
    // read it. Item and artifact — the same split every other kind makes.
    const t = tupleFromIssue(issue());
    expect(t.name.label).toBe('228: Fleet scan asks the host once per branch');
    expect(t.name.href).toBe('https://host/issues/228');
  });

  it('carries the age — the sort key the section orders by', () => {
    // A ticket open for three weeks is exactly what WAITING ON YOU orders by, so
    // dropping it would make that sort invisible on one of the section's four
    // kinds. Measured: the board already renders `1d` for issues #227 and #228.
    expect(tupleFromIssue(issue({ ageMinutes: 1440 })).age.text).toBe('1d');
    // UNLABELLED, because since-last-change is the rule and an issue's age is
    // since it was opened, which is the last thing that happened to it.
    expect(tupleFromIssue(issue()).age.label).toBe('');
  });

  it('renders no age at all where the host gave no date', () => {
    // Absent, not zero: `0m` would claim the issue was opened this instant.
    expect(tupleFromIssue(issue({ ageMinutes: null })).age.text).toBe('');
  });

  it('keeps the number as text where the tracker reported no address', () => {
    expect(tupleFromIssue(issue({ url: '' })).name.href).toBe('');
  });
});

describe('age is one clock, and the label marks the exception', () => {
  it('leaves the rule unlabelled', () => {
    // Everything but the two exceptions is aged from its LAST CHANGE, and it
    // says nothing, because that is the rule. A label on the rule would be
    // decoration; the four-meanings column was unlabelled *because* its meaning
    // varied, and this is the inverse.
    expect(tupleFromRow(row({ ageMinutes: 45 })).age).toEqual({ text: '45m', label: '' });
    expect(tupleFromRow(row({ ageMinutes: 180 })).age.text).toBe('3h');
    expect(tupleFromRow(row({ ageMinutes: 2880 })).age.text).toBe('2d');
  });

  it('labels a not-started row, whose clock is the plan approval', () => {
    // NOT a change to the branch — nothing has changed, that is the point of
    // the row. `22d` meaning "no commits for three weeks" beside `22d` meaning
    // "never begun" is the ambiguity `waitingDays` was split off to end, and
    // the schema's own comment says *the row labels it rather than merging it*.
    const unstarted = tupleFromRow(row({
      kind: 'branch', state: 'open', ageMinutes: null, waitingDays: 22,
    }));
    expect(unstarted.age).toEqual({ text: '22d', label: 'waiting' });
  });

  it('gives an agent TWO labelled clocks, and it is the only kind that does', () => {
    // An agent does not change, it ACTS, so the single rule has nothing to
    // read. What a reader wants is *how long has this run been going* and *how
    // long has it been silent*, and the second is the one that says whether it
    // is stuck.
    const t = tupleFromAgent({
      sessionId: 'f30b27a3-9c1e-4f2b-bb77-0d5a1e2f3c44',
      branch: 'feature/x', branchUrl: 'https://host/tree/feature/x',
      status: 'thinking', sessionSeconds: 27 * 60, idleSeconds: 4 * 60,
    });
    expect(t.age.text).toBe('27m · idle 4m');
    expect(t.age.label).toBe('session');
  });

  it('renders no age where there is neither a tip nor an approval date', () => {
    // Absent is absent. Not zero, not "just now".
    expect(tupleFromRow(row({ ageMinutes: null, waitingDays: null })).age.text).toBe('');
  });

  it('gives a plan the approval clock, labelled', () => {
    // A plan's branches have no tip, so the commit clock has nothing to say and
    // the approval clock is the only one running — and it is not a change to
    // the plan, so it wears its label like every other exception.
    const t = tupleFromPlan({
      plan: 'a-plan', planFile: '2026-08-20-a-plan.md', phase: 'Design', waitingDays: 3,
    });
    expect(t.age).toEqual({ text: '3d', label: 'waiting' });
  });
});

describe('an agent is named by its session id, never by an invented handle', () => {
  it('shortens the session id and renames nothing', () => {
    // The plan's own example said `@Dev-Agent`, and that name was dropped as a
    // placeholder that was never a fact. Agents already have a real identity:
    // the session id the runtime writes as its transcript filename, which the
    // manifest keys on BECAUSE it survives the branch.
    const id = 'f30b27a3-9c1e-4f2b-bb77-0d5a1e2f3c44';
    const t = tupleFromAgent({
      sessionId: id, branch: 'feature/x', branchUrl: '',
      status: 'thinking', sessionSeconds: 60, idleSeconds: null,
    });
    expect(t.name.label).toBe('f30b27a3');
    expect(t.name.label).toBe(shortSessionId(id));
    expect(t.name.label.length).toBe(SESSION_ID_CHARS);
    // It is a PREFIX of the real id, so a reader can match it against a
    // transcript file. An invented handle could not be matched against
    // anything.
    expect(id.startsWith(t.name.label)).toBe(true);
  });

  it('links the branch it holds, not the transcript', () => {
    // The transcript is a local file and the agent panel is what opens it —
    // reached from the row's MENU, where actions live.
    const t = tupleFromAgent({
      sessionId: 'abcdef1234', branch: 'feature/x',
      branchUrl: 'https://host/tree/feature/x', status: 'waiting',
      sessionSeconds: null, idleSeconds: null,
    });
    expect(t.name.href).toBe('');
    expect(t.links).toEqual([
      { what: 'branch', label: 'feature/x', href: 'https://host/tree/feature/x' },
    ]);
  });
});

describe('every kind fills all six slots', () => {
  // A kind with no data renders NO ROW — it does not render an empty one. So
  // this walks the seven and asserts each one PROJECTS completely: the slots
  // exist for every kind, which is what makes the shape a shape rather than a
  // description of the three that happen to have components.
  const projections: Record<RowKind, () => ReturnType<typeof tupleFromRow>> = {
    ticket: () => tupleFromIssue(issue()),
    plan: () => tupleFromPlan({
      plan: 'a-plan', planFile: '2026-08-20-a-plan.md', phase: 'Design', waitingDays: 1,
    }),
    pr: () => tupleFromRow(row({
      kind: 'pr', pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'green' },
      branchUrl: 'https://host/tree/feature/x',
    })),
    build: () => tupleFromBuild({
      name: 'CI:1860', url: 'https://host/run/1860', prNumber: 283,
      prUrl: 'https://host/pr/283', status: 'CI is running', ageMinutes: 10,
    }),
    agent: () => tupleFromAgent({
      sessionId: 'f30b27a3ab', branch: 'feature/x', branchUrl: 'https://host/tree/feature/x',
      status: 'thinking', sessionSeconds: 27 * 60, idleSeconds: 4 * 60,
    }),
    branch: () => tupleFromRow(row({
      kind: 'branch', branchUrl: 'https://host/tree/feature/x', state: 'wip',
    })),
    release: () => tupleFromRow(row({
      kind: 'release', plan: '2.7.0', planFile: '', branch: 'changeset-release/main',
      branchUrl: 'https://host/tree/changeset-release/main', ageMinutes: 12,
      pr: { number: 300, url: 'https://host/pr/300', draft: false, state: 'none' },
    })),
  };

  for (const kind of RowKindSchema.options) {
    it(`fills the six slots for a ${kind}`, () => {
      const t = projections[kind]();
      expect(t.kind).toBe(kind);
      expect(t.icon).toBeTruthy();          // slot 1
      expect(t.kindLabel).toBeTruthy();     // slot 2
      expect(t.name.label).toBeTruthy();    // slot 3
      expect(Array.isArray(t.links)).toBe(true); // slot 4 — zero or more
      expect(t.status).toBeTruthy();        // slot 5
      expect(t.age.text).toBeTruthy();      // slot 6
    });
  }

  it('gives a plan phase to the PLAN and to no other kind', () => {
    // THE RELOCATION, asserted across all seven at once — which is the only
    // place it can be asserted as a rule rather than as six separate absences.
    //
    // The phase is a fact about a PLAN. Slot 5 on a plan row is where it is
    // true, and 71 branch rows printed it anyway (36 `Development`, 26
    // `Endgame`, 9 `Design`) because slot 2 was a column looking for something
    // to hold. A PR row and a build row have no phase at all — a CI run is not
    // in `Endgame` — and a ticket has never entered the lifecycle the word
    // comes from.
    //
    // Every projection here is handed a row that COULD leak one: `row()` carries
    // `phase` and the plan fixture is in `Design`, so a projection reading
    // `row.phase` into slot 5 would be caught rather than passing on absent data.
    const PHASES = ['Discovery', 'Design', 'Development', 'Endgame', 'Released'];
    for (const kind of RowKindSchema.options) {
      const t = projections[kind]();
      if (kind === 'plan') {
        expect(t.status).toBe('Design');
        continue;
      }
      expect(PHASES, `${kind} wears a plan phase in slot 5`).not.toContain(t.status);
    }
  });

  it('points a build BACK at its PR where a ticket points FORWARD at its plan', () => {
    // Direction is a property of the PAIR rather than a rule the reader has to
    // hold: both slots are linked and each says what it is, so a reader never
    // has to infer which way the chain runs.
    const build = projections.build();
    expect(build.links.map((l) => l.what)).toEqual(['pr']);
    expect(build.name.label).toBe('CI:1860');
  });
});

describe('slot 5 holds a value, never a sentence', () => {
  it('reads the PR condition from the field, not from the note', () => {
    // The standing rule at `ELIGIBLE_NOTE`: nothing new may be built on
    // matching prose. A reworded note does not break such a consumer, it makes
    // it quietly stop classifying.
    const conflicting = row({
      kind: 'pr', note: 'PR #57 · something else entirely',
      pr: { number: 57, url: '', draft: false, state: 'conflicts' },
    });
    expect(tupleFromRow(conflicting).status).toBe('conflicts');
  });

  it('says draft before a check state — a different question, asked first', () => {
    // *Is this offered for review* outranks *what is it waiting for* in one
    // slot: a draft is not yours to look at yet, whatever its CI says.
    const draft = row({
      kind: 'pr', pr: { number: 57, url: '', draft: true, state: 'failing' },
    });
    expect(tupleFromRow(draft).status).toBe('draft');
  });

  it('falls back to the git state where there is no PR', () => {
    expect(tupleFromRow(row({ state: 'merged', pr: null })).status).toBe('merged');
    expect(tupleFromRow(row({ state: 'claimed', pr: null })).status).toBe('claimed');
    expect(tupleFromRow(row({ state: 'open', pr: null })).status).toBe('open');
  });

  it('renders nothing where the host could not report a condition', () => {
    // `unknown` is the host declining to answer, and a row printing its own
    // ignorance as a status has said nothing in a slot a reader scans.
    const unknown = row({
      kind: 'pr', pr: { number: 57, url: '', draft: false, state: 'unknown' },
    });
    expect(tupleFromRow(unknown).status).toBe('');
  });

  it('puts the PHASE on the plan row, which is the object it describes', () => {
    // 71 branch rows printed their plan's phase — 36 `Development`, 26
    // `Endgame`, 9 `Design` — a fact about the plan on a row about something
    // else. Slot 5 on the PLAN row is where that fact is true.
    expect(tupleFromPlan({
      plan: 'p', planFile: 'f.md', phase: 'Endgame', waitingDays: null,
    }).status).toBe('Endgame');
  });
});

describe('no host call is added', () => {
  it('projects from the row alone, with no fetch or import of a host adapter', () => {
    // This is a SHAPING change: every one of the six slots is derivable from
    // what the pulse already carries. The projection imports its types and
    // nothing else — a `fetch` or a host import here would mean the tuple made
    // the board ask the host a new question per row.
    const src = readFileSync(
      new URL('../../src/app/lib/tuple-row.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/plot-host|execFile|spawn/);
    // One import, and it is the contract's types.
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/contract\/schema\.js/);
  });
});
