import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  KIND_ICON_PATH,
  prStatus,
  planPrAggregate,
  statusTone,
  KIND_LABEL,
  SESSION_ID_CHARS,
  agentStateStatus,
  releaseVersion,
  shortSessionId,
  tupleFromAgent,
  tupleFromBuild,
  tupleFromIssue,
  tupleFromPlan,
  tupleFromRow,
  tupleFromWave,
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

describe('rowKind — the server\'s judgement about what a row is about', () => {
  it('marks an idea branch\'s PR as a PLAN, whatever the draft flag says', () => {
    // *"Technically this is also a PR but we need to detect that this is a plan
    // approval PR and show it as a plan"* — and *"it could be a draft PR but it
    // does not have to be, the branch name gives it away."*
    //
    // The BRANCH NAME is the whole test, and `rowKind` never receives the draft
    // flag at all — which is the strongest form of that independence. A plan PR
    // ready for review is still a plan: the act it wants is approval, performed
    // by `plot-approve.sh` on a plan and no branch, not the review a `pr` row
    // asks for.
    expect(rowKind('idea/a-wave-is-a-thing-not-a-label', true, false)).toBe('plan');
    // A CONFLICTING plan PR is still a plan. Ordered above the conflict arm on
    // purpose: what it wants is approval, not a rebase.
    expect(rowKind('idea/a-wave-is-a-thing-not-a-label', true, true)).toBe('plan');
  });

  it('calls an idea branch a PLAN with no PR at all', () => {
    // Reversed 2026-08-21: *"Ein plan Branch (idea/) mit oder ohne PR ist ein
    // PLAN"*. The branch holds markdown and nothing else, so it IS a plan before
    // anyone opens a draft PR on it. Whether a review has been asked for is the
    // row's status; what the row IS is its kind.
    expect(rowKind('idea/some-plan', false, false)).toBe('plan');
  });

  it('keeps a release a release, which the idea arm cannot outrank', () => {
    // The two cannot both match, and the order records that rather than relying
    // on it: a release branch is never an idea branch.
    expect(rowKind('changeset-release/main', true, false)).toBe('release');
  });

  it('leaves every other branch exactly as it was', () => {
    // The arm is NARROW — a prefix `/plot-idea` itself writes, and nothing else
    // moves. A repo that renames the prefix gets `pr`, which is the behaviour
    // from before this arm existed rather than a wrong answer.
    expect(rowKind('feature/x', true, false)).toBe('pr');
    expect(rowKind('feature/x', true, true)).toBe('branch');
    expect(rowKind('feature/x', false, false)).toBe('branch');
    // Not a prefix MATCH inside the name — `idea/` has to lead.
    expect(rowKind('feature/an-idea/x', true, false)).toBe('pr');
  });
});

describe('the contract carries all eight kinds', () => {
  it('names exactly the eight, and no ninth', () => {
    // The SHAPE rather than an inventory of what exists: four of the seven had
    // no row when this was written and were named anyway, because a shape that
    // admits only today's kinds has to be reopened for each new one — which is
    // how this board arrived at three row components and two grids.
    //
    // `wave` is the eighth, added 2026-08-20, and it is the case that proves the
    // gate: adding the enum member failed THIS test, both projection loops
    // below, and the `Record<RowKind, …>` icon and label tables — so a kind
    // cannot arrive without a word, a glyph and a projection.
    expect([...RowKindSchema.options].sort()).toEqual(
      ['agent', 'branch', 'build', 'plan', 'pr', 'release', 'ticket', 'wave']);
  });

  it('gives every kind a word and a glyph', () => {
    // TWO CHANNELS, and the word is the one that matters: recognition must not
    // DEPEND on decoding a symbol. The defect this replaces was a kind stated
    // only in a tooltip.
    for (const kind of RowKindSchema.options) {
      expect(KIND_LABEL[kind], kind).toBeTruthy();
      expect(KIND_ICON_PATH[kind], kind).toBeTruthy();
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
      slices: [{
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

  it('calls a branch in a wave a WAVE, open PR or not', () => {
    // THE RANK CHANGED ON 2026-08-21, because a wave is the SUBJECT and a PR is
    // the vehicle it rides on — *"Sie sind nicht der Gegenstand, sie sind das
    // Vehikel"*, Ein Team, ein Plan, viele Agenten (Quatico, 2026). A wave is the
    // process construct that carries a plan forward, `plan → wave → branch`; the
    // PR is an event at the branch while that wave is carried out.
    //
    // `feature/plain` sits in the wave `Shaped` AND carries an open PR, which is
    // exactly the collision the rank decides. The PR has not gone anywhere — it
    // is a link in slot 4 and a status in slot 5. What changed is which of the
    // two the row is ABOUT.
    //
    // Corroborating, not deciding: the measurement once cited FOR `pr` inverts on
    // reading — *67 of 80 rows carry BOTH a branch and a PR*, so `pr` separates
    // almost nothing.
    const rows = rowsFromPulse(pulse, ages, 'plot', 30, new Map([['feature/plain', pr()]]));
    expect(rows.find((r) => r.branch === 'feature/plain')!.kind).toBe('wave');
  });

  it('still calls a branch with a PR and NO wave a pr', () => {
    // The `pr` arm survives, one rank lower: it answers for a branch nobody has
    // sliced into a wave. Without this the change above would read as *the pr
    // kind was deleted*, and it was not.
    // *"Ein PR der einen Branch hat der zu keinem Plan gehört ist ein PR."* The
    // test is the PLAN, so this asserts the arm directly rather than by emptying
    // a wave's name — a branch under a plan is a wave whatever its wave is called.
    expect(rowKind('feature/plain', true, false, '')).toBe('pr');
  });

  it('calls a CONFLICTING branch a branch, even with an open PR', () => {
    // No PR resolves a conflict: the reader has to go to the branch and rebase.
    // This is the one arm that overrides an open PR, and it is why the kind
    // cannot be `row.pr ? 'pr' : 'branch'`.
    const prs = new Map([['feature/clashing', pr({ head: 'feature/clashing' })]]);
    const rows = rowsFromPulse(pulse, ages, 'plot', 30, prs);
    expect(rows.find((r) => r.branch === 'feature/clashing')!.kind).toBe('branch');
  });

  it('calls a branch in a NAMED WAVE a wave, even with no PR', () => {
    // THE FOURTH TEST, added 2026-08-21: *"we should only see a branch row if the
    // branch does not carry a wave, and … does not carry a draft plan, and …
    // does not have a PR, and … is not a release branch."*
    //
    // This asserted `branch`, written when a wave was a string on a row rather
    // than a kind. `feature/plain` sits in the wave `Shaped` in this fixture, so
    // the wave is what the row is ABOUT — a branch cut for a wave is that wave's
    // work, and the count of branches in it is a fact about how the plan was
    // written.
    const rows = rowsFromPulse(pulse, ages, 'plot', 30);
    expect(rows.find((r) => r.branch === 'feature/plain')!.kind).toBe('wave');
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
    // The icon is no longer a field on the tuple: it is drawn from `kind` by the
    // renderer, because emoji ignored CSS colour and the set is now SVG paths.
    expect(KIND_ICON_PATH[t.kind]).toBeTruthy();
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

describe('slot 5 says where a PR stands, and draft is not a state', () => {
  it('reports the CHECK STATE on a draft, never the word draft', () => {
    // `draft` and `state` answer DIFFERENT questions — *is this offered for
    // review* and *what is it waiting for* — and they are independent: a draft
    // has CI like anything else. `prStatus` returned `'draft'` before consulting
    // the state until 2026-08-20, which is the exact short-circuit that kept
    // WAITING ON A MACHINE empty for three releases: the classifier used to
    // return on every draft before the checks were read.
    //
    // The flag still reaches the row, as its OWN badge beside this word rather
    // than instead of it. Slot 5 holds one value; the draft is a second fact.
    expect(prStatus({ number: 1, url: 'u', draft: true, state: 'pending' }))
      .toBe('CI running');
    expect(prStatus({ number: 1, url: 'u', draft: true, state: 'conflicts' }))
      .toBe('conflicts');
    // And the state is the same word whether or not it is a draft, which is
    // what *independent* means.
    for (const state of ['green', 'pending', 'failing', 'none', 'conflicts'] as const) {
      expect(prStatus({ number: 1, url: 'u', draft: true, state }))
        .toBe(prStatus({ number: 1, url: 'u', draft: false, state }));
    }
  });

  it('says nothing at all where the host could not report a state', () => {
    // `unknown` is the host saying *I could not find out*, and a row printing
    // its own ignorance in a slot a reader scans has said nothing. Absent
    // renders as absent — and that holds on a draft too, which is the pairing:
    // an implementation that returned `draft` here would pass every assertion
    // above and still print a word where there is no answer.
    expect(prStatus({ number: 1, url: 'u', draft: false, state: 'unknown' })).toBe('');
    expect(prStatus({ number: 1, url: 'u', draft: true, state: 'unknown' })).toBe('');
  });
});

describe('a folded plan folds its branches PR states into one word', () => {
  // The DATA half of the fold. Whether the badge stays on both plan-head paths
  // and stays while expanded is what only a rendered page can settle — see
  // `test/integration/folded-plan-pr-fold.browser.test.ts`. Everything here is
  // the precedence and the count, which are pure.

  it('takes the WORST-CASE word, conflicts over failing', () => {
    // `conflicts` outranks `failing` because no PR resolves a conflict — the
    // errand is a rebase and it is the reader's — while a failing check is the
    // machine's report on work already pushed. A plan carrying both sends the
    // reader to the harder errand.
    expect(planPrAggregate(['failing', 'conflicts'])?.word).toBe('conflicts');
    expect(planPrAggregate(['conflicts', 'failing'])?.word).toBe('conflicts');
    expect(planPrAggregate(['conflicts', 'failing'])?.state).toBe('conflicts');
  });

  it('orders failing above pending, and pending above the quiet states', () => {
    expect(planPrAggregate(['pending', 'failing'])?.word).toBe('checks failing');
    expect(planPrAggregate(['green', 'pending'])?.word).toBe('CI running');
    expect(planPrAggregate(['pending', 'green', 'none'])?.state).toBe('pending');
  });

  it('counts only the branches carrying the WINNING state', () => {
    // The count is how many branches carry exactly the word shown — a plan of
    // two conflicts and one failing says `conflicts (2)`, not `(3)`: the count
    // qualifies the errand the badge names, not the size of the fold.
    const fold = planPrAggregate(['conflicts', 'conflicts', 'failing']);
    expect(fold?.word).toBe('conflicts');
    expect(fold?.count).toBe(2);
  });

  it('reports a count of ONE where a single branch carries the state', () => {
    // The renderer suppresses `(1)` — a lone branch says its own size by being
    // one row. The function reports the true count and leaves that to the
    // consumer, which is the split the brief draws: *a count appears only where
    // more than one branch is affected*.
    expect(planPrAggregate(['failing', 'green'])?.count).toBe(1);
  });

  it('says NOTHING for a plan whose branches are green, quiet, or PR-less', () => {
    // Green plans get no badge — nothing to act on, and a badge on every row is
    // a badge nobody reads. `none`/`unknown` are the host declining to answer,
    // `closed` is abandoned work, and a branch with no PR contributes no state:
    // a plan of unstarted branches folds to nothing, which is right.
    expect(planPrAggregate(['green', 'green'])).toBeNull();
    expect(planPrAggregate(['none', 'unknown', 'closed'])).toBeNull();
    expect(planPrAggregate([null, undefined])).toBeNull();
    expect(planPrAggregate([])).toBeNull();
    // A green plan beside quiet states is still silent — green does not earn a
    // word even when it is the only thing to say.
    expect(planPrAggregate(['green', 'none', 'closed'])).toBeNull();
  });

  it('speaks the SAME word a single-row plan would for that state', () => {
    // The fold reuses `prStatus`'s vocabulary, so slot 5 reads one language
    // whether the word came from one branch or five — the carried-over rule
    // that a state is a WORD, unchanged by aggregation.
    for (const state of ['conflicts', 'failing', 'pending'] as const) {
      expect(planPrAggregate([state])?.word)
        .toBe(prStatus({ number: 0, url: '', draft: false, state }));
    }
  });
});

describe('slot 3 is the item and slot 4 is the vehicle', () => {
  it('gives a PR row separate links to separate destinations', () => {
    // A PR names the PR, its plan and its branch — all already on the row:
    // measured on the live pulse, a PR row carries `plan`, `planFile`, `branch`,
    // `branchUrl` and `pr`. Nothing new is fetched; what was missing is that only
    // some rendered, and only one was a link.
    //
    // WITHOUT A WAVE here, which is the planless-PR case: `changeset-release/*`
    // and `idea/*` reach the board through a loop that sets `wave: ''`.
    const t = tupleFromRow(row({
      kind: 'pr', wave: '',
      pr: { number: 57, url: 'https://host/pr/57', draft: false, state: 'conflicts' },
      branchUrl: 'https://host/tree/feature/x',
    }));
    expect(t.name).toMatchObject({ what: 'pr', label: '57', href: 'https://host/pr/57' });
    // NARROWEST FIRST, CONTAINER LAST — the order every arm uses since
    // 2026-08-22. This read `['plan', 'branch']`, the reverse, and the two
    // orders were mixed across the six arms until a reader spotted a plan row
    // and a wave row on one screen naming the same two artifacts oppositely.
    expect(t.links.map((l) => l.what)).toEqual(['branch', 'plan']);
    // DISTINCT DESTINATIONS. Interchangeable words are what the association
    // requirement exists to prevent.
    const targets = [t.name.href, ...t.links.map((l) => l.href)];
    expect(new Set(targets).size).toBe(3);
  });

  it('adds the WAVE where the PR\'s branch belongs to one', () => {
    // *"The PR item may have a WAVE if the branch is assigned to a WAVE."* A
    // branch cut for a plan's wave keeps that membership through review, and
    // `row.wave` carried it all along with nothing rendering it.
    //
    // Ordered plan → wave → branch, the chain narrowing: the plan holds the
    // wave, the wave holds the branch.
    const t = tupleFromRow(row({
      kind: 'pr', wave: 'Modelled',
      pr: { number: 304, url: 'https://host/pr/304', draft: false, state: 'green' },
      branchUrl: 'https://host/tree/feature/x',
    }));
    expect(t.links.map((l) => l.what)).toEqual(['wave', 'branch', 'plan']);
    expect(t.links[0]).toMatchObject({ label: 'Modelled', href: '' });
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

  it('names its PR where no version is known, AND SAYS SO with a #', () => {
    // Changesets names the branch after the BASE, not the version, so most
    // release rows honestly know no version. Deriving `2.7.0` would mean summing
    // pending bumps — *what would this ship* — the question the plan refuses to
    // answer on a board, because it makes the board where release decisions are
    // prepared.
    //
    // THE FALLBACK MUST SAY SO. A bare `300` in the name slot of a release row
    // reads like a version — `3.0.0` truncated, a major, something a reader
    // decides about — when it is only the PR the version could not be read from.
    // The `#` is the universal mark for a PR/issue number, so `#300` can never
    // be mistaken for the version the slot usually holds. The plan's test list
    // ends on exactly this case: *falls back to the PR number and says so,
    // rather than showing a number that reads like a version*.
    expect(releaseVersion(release)).toBe('');
    expect(tupleFromRow(release).name.label).toBe('#300');
    // And where a version IS on the row, it leads UNPREFIXED — the version is
    // what a reader decides about, and it is a version, not a reference to one.
    expect(tupleFromRow({ ...release, plan: '2.7.0' }).name.label).toBe('2.7.0');
    // The two are distinguishable at a glance, which is the whole point: a
    // version never wears the `#`, a stand-in number always does.
    expect(tupleFromRow(release).name.label.startsWith('#')).toBe(true);
    expect(tupleFromRow({ ...release, plan: '2.7.0' }).name.label.startsWith('#'))
      .toBe(false);
  });

  it('carries no action of its own — the tuple says what a row IS', () => {
    // A menu entry offering to release would put an outward-facing act on a
    // board, and this repo cuts a release only on an explicit request. The
    // projection produces slots and no items at all; the browser suite asserts
    // the rendered menu offers none.
    expect(Object.keys(tupleFromRow(release))).toEqual(
      ['kind', 'kindLabel', 'status', 'age', 'name', 'links']);
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
    wave: () => tupleFromWave({
      name: 'Shaped', plan: 'a-plan', verdict: 'eligible',
      blockedBy: null, outstanding: 1,
      branches: [{ branch: 'feature/x', branchUrl: 'https://host/tree/feature/x' }],
      ageMinutes: 1440, waitingDays: 1,
    }),
  };

  for (const kind of RowKindSchema.options) {
    it(`fills the six slots for a ${kind}`, () => {
      const t = projections[kind]();
      expect(t.kind).toBe(kind);
      expect(KIND_ICON_PATH[t.kind]).toBeTruthy();   // slot 1 — drawn from kind
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
    // `Testing`, 9 `Design`) because slot 2 was a column looking for something
    // to hold. A PR row and a build row have no phase at all — a CI run is not
    // in `Testing` — and a ticket has never entered the lifecycle the word
    // comes from.
    //
    // Every projection here is handed a row that COULD leak one: `row()` carries
    // `phase` and the plan fixture is in `Design`, so a projection reading
    // `row.phase` into slot 5 would be caught rather than passing on absent data.
    const PHASES = ['Discovery', 'Design', 'Development', 'Testing', 'Released'];
    for (const kind of RowKindSchema.options) {
      const t = projections[kind]();
      if (kind === 'plan') {
        expect(t.status).toBe('Design');
        continue;
      }
      expect(PHASES, `${kind} wears a plan phase in slot 5`).not.toContain(t.status);
    }
  });

  it('names the WAVE and links its branches, unprefixed by any plan', () => {
    // THE FIVE DEFECTS FROM ONE FRAME, pinned together — measured on the mock
    // 2026-08-20, where a three-wave plan rendered four rows all labelled
    // `PLAN`, each naming its BRANCH, each linking
    // `PLAN fleet-scan-asks-the-host` directly beneath the plan row heading
    // them, each showing `open` where the scan had computed the verdict.
    const t = tupleFromWave({
      name: 'Shaped', plan: 'fleet-scan-asks-the-host', verdict: 'eligible',
      branches: [{ branch: 'feature/the-scan-asks-once', branchUrl: 'https://host/tree/x' }],
      ageMinutes: 1440, waitingDays: 1,
    });
    expect(t.kindLabel).toBe('Wave');                 // not `Plan`
    expect(t.name.label).toBe('Shaped');              // the wave, not the branch
    // NO PLAN LINK. Containment needs no prefix AND no link — the row the wave
    // sits under IS the link, and a `PLAN x` label on a row nested under `x`
    // says the same thing twice.
    expect(t.links.map((l) => l.what)).toEqual(['branch']);
    expect(t.links[0].label).toBe('feature/the-scan-asks-once');
    expect(t.status).toBe('eligible');                // the verdict, not `open`
  });

  it('links every branch a wave holds', () => {
    // Slot 4 is zero-or-more, and the wave is the kind that uses its upper end:
    // `opus5-longhorizon-hardening :: Implementation` holds five.
    const t = tupleFromWave({
      name: 'Implementation', plan: 'opus5-longhorizon-hardening', verdict: 'blocked',
      blockedBy: 'Tracer', outstanding: 5,
      branches: Array.from({ length: 5 }, (_, i) => ({
        branch: `feature/opus5-hardening-${i}`, branchUrl: `https://host/tree/${i}`,
      })),
      ageMinutes: null, waitingDays: 25,
    });
    // FIVE links, and ONLY the branches. Slot 4 holds what the wave contains;
    // the blocker it waits on points the other way and renders beside the NAME.
    expect(t.links).toHaveLength(5);
    expect(t.links.every((l) => l.what === 'branch')).toBe(true);
    // THE VERDICT AND ITS OWN COUNT. `blocked` alone does not say how much is
    // left, and the five branches are folded out of sight.
    expect(t.status).toBe('blocked · 5 left');
  });

  it('splits `blocked by Relocated — 1 outstanding` into its three facts', () => {
    // THE SENTENCE, DECOMPOSED — and the operator's own decomposition:
    // *"blocked ist der status, by Relocated die reference (als Link),
    // — 1 outstanding an die WAVE Zeile"*.
    //
    // `blockedNote()` composed all three into prose and printed it in the note
    // column, one line below the very row it named. Each has a slot:
    const t = tupleFromWave({
      name: 'Moved', plan: 'a-plan', verdict: 'blocked',
      blockedBy: 'Relocated', outstanding: 1,
      branches: [{ branch: 'bug/the-old-column-goes', branchUrl: 'https://host/tree/x' }],
      ageMinutes: 1440, waitingDays: 1,
    });
    // `blocked` — the verdict, in slot 5. One branch left, so no count: the
    // single branch link in slot 4 already shows what remains.
    expect(t.status).toBe('blocked');
    // `by Relocated` — a REFERENCE, and it is NOT in slot 4. Slot 4 holds what
    // the wave contains; the blocker renders as an INFO MARK beside the status
    // in slot 5, which the row component owns. Beside the name was tried and
    // measured: the blocker text truncated `Relocated` to `R…` and `Moved` to
    // `M`, so the row lost the one thing it exists to say.
    // So slot 4 carries the branches and nothing else.
    expect(t.links.map((l) => l.label)).toEqual(['bug/the-old-column-goes']);
    expect(t.links.every((l) => l.what === 'branch')).toBe(true);
  });

  it('puts the outstanding count on the wave it counts, not on the one waiting', () => {
    // `— 1 outstanding` counted the BLOCKER's unfinished branches and printed
    // them on the row that WAITED. So a wave holding three others back printed
    // its count three times, each time describing a row the reader had to find
    // by name. On its own row it is stated once, and only where it says
    // something a folded link does not.
    const two = tupleFromWave({
      name: 'Relocated', plan: 'a-plan', verdict: 'blocked',
      blockedBy: null, outstanding: 2,
      branches: [], ageMinutes: 60, waitingDays: null,
    });
    expect(two.status).toBe('blocked · 2 left');
    const one = tupleFromWave({
      name: 'Relocated', plan: 'a-plan', verdict: 'blocked',
      blockedBy: null, outstanding: 1,
      branches: [], ageMinutes: 60, waitingDays: null,
    });
    expect(one.status).toBe('blocked');
  });

  it('names a BUILD by its run and links both its artifacts', () => {
    // `tupleFromBuild` existed with NO CALLER, so a build row — which arrives
    // from the server as an `AgentRow` — fell through to the branch fallback.
    // Measured on the mock: `BUILD  feature/a-build-is-running |
    // CI is running for PR #283 | CI running 283` — the branch as the subject, a
    // sentence where the artifacts belong, and the PR number inside slot 5.
    const t = tupleFromRow(row({
      kind: 'build', ageMinutes: 10, wave: '',
      branch: 'feature/a-build-is-running',
      branchUrl: 'https://host/tree/feature/a-build-is-running',
      pr: { number: 283, url: 'https://host/pull/283', draft: false, state: 'pending' },
    }));
    expect(t.name.label).toBe('CI 283');
    // TEXT, not a link: no run URL is on the wire. A fabricated
    // `<repo>/pull/<n>/checks` is the guess this board refuses everywhere.
    expect(t.name.href).toBe('');
    // BOTH artifacts, PR first — a run reports to the PR and runs on the branch.
    expect(t.links.map((l) => l.what)).toEqual(['pr', 'branch']);
    expect(t.status).toBe('CI running');
    expect(t.age.text).toBe('10m');
  });

  it('gives a BUILD with no PR its branch as the name', () => {
    // A build on a branch with no PR yet: the branch is the only identity, and
    // the artifact slot still holds it — the row's subject and its artifact can
    // be the same thing when nothing else names it.
    const t = tupleFromRow(row({
      kind: 'build', branch: 'feature/x', branchUrl: 'https://host/tree/feature/x',
      pr: null, ageMinutes: 4, wave: '',
    }));
    expect(t.name.label).toBe('feature/x');
    expect(t.links.map((l) => l.what)).toEqual(['branch']);
  });

  it('gives a BUILD its wave where the branch belongs to one', () => {
    // A branch cut for a wave keeps that membership through review AND through
    // CI, so the run reports on a wave's work. The wave is the optional middle
    // link, exactly as it is on a PR: a build on `changeset-release/main`
    // belongs to no wave.
    const t = tupleFromRow(row({
      kind: 'build', wave: 'Modelled', ageMinutes: 10,
      branch: 'feature/a-build-is-running',
      branchUrl: 'https://host/tree/feature/a-build-is-running',
      pr: { number: 283, url: 'https://host/pull/283', draft: false, state: 'pending' },
    }));
    expect(t.links.map((l) => l.what)).toEqual(['wave', 'pr', 'branch']);
  });

  it('gives an AGENT the worker state, never the branch state', () => {
    // The row read `open` — the BRANCH's state, on a row about the agent that
    // took it. Every worker exits 0, so `worker` is the only field that can say
    // what the agent is doing.
    const t = tupleFromRow(row({
      kind: 'agent', worker: 'running', state: 'open', ageMinutes: 27,
    }));
    expect(t.status).toBe('working');
    expect(t.status).not.toBe('open');
  });

  it('says WHICH kind of running — a working child reads apart from an idle one', () => {
    // ITEM 5 at the render layer. `running` is honest and coarse; the activity
    // cue splits a worker mid-work from one whose child crashed while the loop
    // waited on it. A cue that never fires and one that always fires are equally
    // useless, so BOTH arms are asserted and asserted to DIFFER.
    const busy = tupleFromRow(row({ kind: 'agent', worker: 'running', worker_activity: 'working' }));
    const idle = tupleFromRow(row({ kind: 'agent', worker: 'running', worker_activity: 'idle' }));
    expect(busy.status).toBe('working');
    expect(idle.status).toBe('idle');
    expect(idle.status).not.toBe(busy.status);

    // A NOT A SIXTH STATE. `worker` is still `running` on both — the cue is a
    // secondary word on one state, never a new one. And where the cue is "" (an
    // older pulse, or a platform that could not sample CPU), a running worker
    // still reads `working`: absence of the measurement never HIDES a live
    // worker behind `idle`.
    const unmeasured = tupleFromRow(row({ kind: 'agent', worker: 'running', worker_activity: '' }));
    expect(unmeasured.status).toBe('working');
  });

  it('falls back to the branch state where the worker state says nothing', () => {
    // `none` and `elsewhere` are not activity — the first means no worker, the
    // second that this machine has nowhere to look. Printing a word about a
    // worker it cannot see would be the row stating its own ignorance.
    for (const worker of ['none', 'elsewhere'] as const) {
      const t = tupleFromRow(row({ kind: 'agent', worker, state: 'wip' }));
      expect(t.status, worker).toBe('in progress');
    }
  });

  it('puts a PR number in slot 4, never in the status', () => {
    // *"You cannot put the links to associated artifacts into the status row."*
    // Measured before the change: `no checks 240` on a release and
    // `CI running 283` on a build — a number wedged into the one slot whose
    // whole purpose is a single word a reader scans down a column.
    //
    // Asserted across every kind that carries a PR, because the badge that did
    // this was rendered by the ROW for all of them at once.
    const kinds = [
      row({ kind: 'branch', pr: { number: 57, url: 'https://host/pull/57', draft: false, state: 'green' } }),
      row({ kind: 'build', pr: { number: 283, url: 'https://host/pull/283', draft: false, state: 'pending' } }),
      row({
        kind: 'release', plan: '2.7.0', planFile: '', branch: 'changeset-release/main',
        pr: { number: 240, url: 'https://host/pull/240', draft: false, state: 'none' },
      }),
    ];
    for (const r of kinds) {
      const t = tupleFromRow(r);
      expect(t.status, `${r.kind} status holds a number`).not.toMatch(/\d/);
      const pr = t.links.find((l) => l.what === 'pr') ?? (t.name.what === 'pr' ? t.name : null);
      expect(pr, `${r.kind} has its PR reachable`).toBeTruthy();
    }
  });

  it('renders a nameless wave as text rather than hiding it', () => {
    // Six of this estate's 71 waves have no name, all in plans written before
    // the convention. Refusing to render them would make six real waves
    // invisible to punish six old plan files — and the board is not where an
    // authoring convention is enforced.
    const t = tupleFromWave({
      name: '', plan: 'a-blocked-wave-is-not-eligible', verdict: 'complete',
      blockedBy: null, outstanding: null,
      branches: [], ageMinutes: 60, waitingDays: null,
    });
    expect(t.name.label).toBe('(unnamed)');
    expect(t.name.href).toBe('');
  });

  it('never links a wave name, because a wave has no page', () => {
    // A wave is a HEADING inside a plan file. Linking it to the plan would make
    // three sibling waves three links to one document — which is the same
    // repetition the missing plan prefix removes.
    const t = tupleFromWave({
      name: 'Shaped', plan: 'a-plan', verdict: 'eligible',
      blockedBy: null, outstanding: null,
      branches: [], ageMinutes: 60, waitingDays: null,
    });
    expect(t.name.href).toBe('');
  });

  it('says nothing in slot 5 where the scan reported no verdict', () => {
    // The rule `prStatus` states for `unknown`: a row printing its own ignorance
    // in a column a reader scans has said nothing. Absent renders as absent —
    // and never as `open`, which is a fact about a BRANCH.
    const t = tupleFromWave({
      name: 'Shaped', plan: 'a-plan', verdict: null,
      blockedBy: null, outstanding: null,
      branches: [], ageMinutes: 60, waitingDays: null,
    });
    expect(t.status).toBe('');
  });

  it('falls back to the plan approval clock, labelled, where no branch has a tip', () => {
    // A wave has no tip of its own, so its clock is the clock of the work in it.
    // Where none of its branches has moved, the plan's approval clock is the only
    // one running — and it wears its label, like every other exception to
    // *since last change*.
    const t = tupleFromWave({
      name: 'Relocated', plan: 'a-plan', verdict: 'blocked',
      blockedBy: null, outstanding: null,
      branches: [], ageMinutes: null, waitingDays: 3,
    });
    expect(t.age).toEqual({ text: '3d', label: 'waiting' });
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

  it('holds the CHECK STATE on a draft, and lets the badge say draft', () => {
    // THIS ASSERTED THE OPPOSITE until `one-component-renders-every-row`, and
    // the reversal is the collapse rather than a change of mind. The argument
    // was: *is this offered for review* outranks *what is it waiting for* in
    // ONE slot, because a draft is not yours to look at yet whatever its CI
    // says. That is right about one slot, and slot 5 was the only place a PR's
    // condition appeared while `tupleFromRow` was the whole row.
    //
    // The row now has two places. `PrCell` rendered draft and state as two
    // badges on purpose — `agents-tab` pins it, because *folding draft into the
    // state would rebuild the short-circuit that kept WAITING ON A MACHINE
    // empty for three releases* — and the collapse kept that badge beside slot
    // 5. So there is no precedence left to arbitrate: the draft has its own
    // element, and slot 5 carries the fact nothing else on the row states.
    const draft = row({
      kind: 'pr', pr: { number: 57, url: '', draft: true, state: 'failing' },
    });
    expect(tupleFromRow(draft).status).toBe('checks failing');
  });

  it('falls back to the git state where there is no PR', () => {
    // `delivered` for the state `merged` — Plot's word for the transition, not
    // git's word for what happened to the ref. The STATE keeps its name on the
    // contract (`BranchStateSchema`); only the displayed word changed.
    expect(tupleFromRow(row({ state: 'merged', pr: null })).status).toBe('delivered');
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
    // `Testing`, 9 `Design` — a fact about the plan on a row about something
    // else. Slot 5 on the PLAN row is where that fact is true.
    expect(tupleFromPlan({
      plan: 'p', planFile: 'f.md', phase: 'Testing', waitingDays: null,
    }).status).toBe('Testing');
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

describe('statusTone colours what a reader acts on', () => {
  // The rule is *colour what a reader acts on*, not *colour the problem* —
  // `green` already takes a tone, so a green PR you can merge and an `eligible`
  // wave you can start are the same prompt in one column. `eligible` joins the
  // emerald branch for exactly that reason.
  const EMERALD = 'text-emerald-700 dark:text-emerald-500';
  const ROSE = 'text-rose-700 dark:text-rose-400';

  it('tones `start work` the same emerald as `green`', () => {
    // A branch that can be started is the single most actionable state on the
    // board — brief present, plan approved, wave eligible, nobody on it. It
    // earns the good-news tone BECAUSE a person can act on it, and it takes the
    // SAME class `green` returns: still two colours, not three — a word moves
    // into a group that exists.
    //
    // `eligible` WAS HERE and is deliberately NOT any more. `eligible` answered
    // *has every prior wave landed*, which was true on 26 rows and actionable on
    // 5. `start work` answers *can I start this*, the question a reader asks.
    expect(statusTone('start work')).toBe(EMERALD);
    expect(statusTone('start work')).toBe(statusTone('green'));
  });

  it('tones `eligible` emerald for WAVE rows — the wave verdict is still green news', () => {
    // `eligible` remains green for wave rows, which still display the wave
    // verdict. Branch rows no longer display `eligible` — they display `start
    // work` instead — but wave rows still show the wave-ordering verdict, and an
    // eligible wave is green news: `an-eligible-wave-takes-the-actionable-tone`
    // settled that.
    expect(statusTone('eligible')).toBe(EMERALD);
    expect(statusTone('eligible')).toBe(statusTone('green'));
  });

  it('leaves `blocked` untoned — it is the opposite case', () => {
    // A blocked wave is precisely the one a reader can do nothing about: an
    // earlier wave holding it back is the system working, not a fault. It keeps
    // the ordinary grey, and its note already carries the dimmed `time` tone.
    expect(statusTone('blocked')).toBe('');
  });

  it('leaves `complete` untoned — a complete wave prompts nothing', () => {
    // Arguably finished-like, but its branches have landed and its plan moves
    // on: colouring it would put emerald on rows a reader scrolls past, which
    // is the dilution the two-value rule guards against.
    expect(statusTone('complete')).toBe('');
  });

  it('keeps the emerald group as it was — good news is still good news', () => {
    // The palette does not grow; adding `eligible` does not disturb the words
    // already in the branch.
    expect(statusTone('green')).toBe(EMERALD);
    expect(statusTone('delivered')).toBe(EMERALD);
    expect(statusTone('finished')).toBe(EMERALD);
  });

  it('leaves the rose group unchanged', () => {
    // The bad-news branch is untouched: this plan tones one word and only one.
    expect(statusTone('conflicts')).toBe(ROSE);
    expect(statusTone('checks failing')).toBe(ROSE);
    expect(statusTone('failed')).toBe(ROSE);
    expect(statusTone('stalled')).toBe(ROSE);
  });
});

describe('agentStateStatus — the registry state as a WORKING word', () => {
  // `a-state-is-a-word-not-a-sentence`, Done when #1–3: a `running` agent's row
  // reads `running`, in the same one-word vocabulary its four siblings use. A
  // row whose usual state is a lie teaches its reader to ignore the row, so
  // every state says its own condition plainly.
  //
  // This once asserted `running` → `someone is on it`, a reassurance about a
  // person rather than a state. It read identically on every WORKING row (11 of
  // 11, measured 2026-08-25) and so described nothing; the plan withdrew the
  // sentence. This describe block is the anti-contract: it asserts the state
  // word IS `running`, and item 3 forbids `someone is on it` reappearing here.

  it('reads `running` for a running worker', () => {
    // The state that once claimed a person is at work now names its own
    // condition — the one word, not a sentence about who owns the row.
    expect(agentStateStatus('running')).toBe('running');
  });

  it('says every state plainly, one word per state', () => {
    // All five registry states carry their own word. The negative half is the
    // point: none of them, `running` included, may borrow the withdrawn
    // sentence.
    const words: Record<Parameters<typeof agentStateStatus>[0], string> = {
      running: 'running',
      waiting: 'waiting on you',
      stalled: 'stalled',
      finished: 'finished',
      unknown: 'unknown',
    };
    for (const [state, word] of Object.entries(words)) {
      const actual = agentStateStatus(state as Parameters<typeof agentStateStatus>[0]);
      expect(actual, state).toBe(word);
      expect(actual, state).not.toBe('someone is on it');
    }
  });
});
