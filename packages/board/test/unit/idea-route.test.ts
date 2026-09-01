// `POST /api/idea`: what it refuses, what it spawns, and what the plan it
// produces must contain.
//
// **The DoD assertions that need a real handler run live here.** Four of them
// are about things a pure function cannot show: that nothing reaches the
// tracker, that a host which cannot be asked offers no action, that a second
// plan for one signal is refused, and that the prompt actually carries the
// `Issue:` field the board reads.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the prompt file, the 202
// body, the spawn's argv — never against output a spawned command produces.
// The command these tests configure is `true`, which needs no budget at all.
// The measured failure this avoids: a 1 ms timeout that passed on macOS and
// lost on CI, and a teardown racing a detached child.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { writeGate } from '../../src/server/write-gate.js';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  BODY_MAX,
  composeIdeaPrompt,
  handleIdea,
  ideaAvailability,
  ideaPromptPath,
  slugFromTitle,
  usableCommand,
  type IdeaDeps,
  type IdeaRefusal,
  type IssueDetail,
} from '../../src/server/idea.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');

const made: string[] = [];
afterEach(() => {
  // Synchronous and unconditional. Nothing spawned here outlives the call —
  // `true` has exited by the time the 202 is written — so there is no child to
  // race and `maxRetries` is not being asked to win anything.
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A repo with a plan directory, and whatever plans a test wants in it. */
function repo(plans: Record<string, string> = {}): string {
    // A NESTED DIR, the shape `implement-route.test.ts` established: a
  // spawning command writes its prompt, log and state to
  // `path.resolve(repoRoot, '..')`. With the repo AT the tmpdir root those
  // land in the shared temp directory, survive `rmSync(dir)`, and the next
  // run finds a file a refusal test asserts is absent. One level down puts
  // them inside the tree afterEach removes.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-idea-'));
  made.push(parent);
  const dir = path.join(parent, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
  for (const [name, body] of Object.entries(plans)) {
    fs.writeFileSync(path.join(dir, 'docs/plans', name), body, 'utf8');
  }
  return dir;
}

const ISSUE: IssueDetail = {
  number: 228,
  title: 'Board: the fleet scan asks once per branch',
  body: 'Measured 18.3 s against a 5 s cadence. git alone is 12.7 s of it.',
  url: 'https://example.test/issues/228',
};

/** A request, with a body and the headers a same-origin POST carries. */
function request(body: unknown): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
}

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

/** A response that records rather than writes. */
function response(): { res: http.ServerResponse; got: Captured } {
  const got: Captured = { status: 0, body: {} };
  const res = {
    headersSent: false,
    writeHead(status: number) { got.status = status; return this; },
    end(payload?: string) { got.body = payload ? JSON.parse(payload) : {}; return this; },
  } as unknown as http.ServerResponse;
  return { res, got };
}

/**
 * Run the handler with everything injectable defaulted to a working repo.
 *
 * `Idea command: true` — a command that exists, succeeds and produces nothing.
 * The tests assert what the handler wrote BEFORE spawning, so the command's
 * behaviour is deliberately irrelevant and deliberately instant.
 */
async function post(
  opts: {
    repoRoot: string;
    body?: unknown;
    command?: string;
    issue?: IssueDetail | (() => Promise<IssueDetail>);
    referenced?: Set<number> | null;
    host?: string;
  },
): Promise<Captured> {
  const { res, got } = response();
  const deps: IdeaDeps = {
    config: (_o, key, fallback) =>
      key === 'Idea command' ? (opts.command ?? 'true') : fallback,
    issue: async () => {
      if (typeof opts.issue === 'function') return opts.issue();
      return opts.issue ?? ISSUE;
    },
    referenced: async () =>
      opts.referenced === undefined ? new Set<number>() : opts.referenced,
  };
  await handleIdea(
    request(opts.body ?? { number: 228, type: 'feature' }),
    res,
    { repoRoot: opts.repoRoot, scriptsDir: SCRIPTS, host: opts.host ?? 'localhost', port: 7777 },
    deps,
  );
  return got;
}

describe('the action creates a Draft, and says so', () => {
  it('accepts and writes the problem statement before it answers', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir });
    assert.equal(got.status, 202);
    assert.equal(got.body.ok, true);
    assert.equal(got.body.number, 228);
    // The prompt exists at 202 time — the property that makes every assertion
    // below raceless.
    const prompt = fs.readFileSync(ideaPromptPath(dir, 228), 'utf8');
    assert.match(prompt, /\/plot-idea /);
  });

  it('tells the plan to stop at Draft, in as many words', async () => {
    const dir = repo();
    await post({ repoRoot: dir });
    const prompt = fs.readFileSync(ideaPromptPath(dir, 228), 'utf8');
    // THE PROPERTY THE WHOLE ROW RESTS ON. The row asks *is this worth
    // planning*; anything past Draft would answer it instead of posing it.
    assert.match(prompt, /Stop at \*\*Draft\*\*/);
    assert.match(prompt, /Do not approve it/);
    assert.doesNotMatch(prompt, /\/plot-approve/);
  });

  it('never asks for a write to the tracker', async () => {
    const dir = repo();
    await post({ repoRoot: dir });
    const prompt = fs.readFileSync(ideaPromptPath(dir, 228), 'utf8');
    // Asserted on the INSTRUCTION, because the instruction is what an agent
    // acts on. The adapter half — that no write op is invoked — is asserted in
    // test/reconcile/host.test.mjs against the argv `gh` actually receives.
    assert.match(prompt, /Write nothing to the tracker/);
    for (const write of ['gh issue comment', 'gh issue close', 'gh issue edit', '--add-label']) {
      assert.ok(!prompt.includes(write), `the prompt must not ask for \`${write}\``);
    }
  });
});

describe('the prompt carries the field that makes the row disappear', () => {
  it('names the issue in the shape plot-plan-meta.sh parses', () => {
    const prompt = composeIdeaPrompt({
      issue: ISSUE, slug: 'the-fleet-scan-asks-once', type: 'feature', truncated: false,
    });
    // THE ASSERTION IS A PARSE, NOT A STRING MATCH — the DoD's own requirement.
    // The prompt's instruction is lifted into a real plan file and handed to
    // the real parser, so this test fails if the FIELD SYNTAX drifts, which a
    // regex over the prompt could never catch.
    const line = prompt.split('\n').find((l) => l.includes('**Issue:**'));
    assert.ok(line, 'the prompt must state the Issue field');
    const field = line.slice(line.indexOf('- **Issue:**')).replace(/`/g, '').trim();

    const dir = repo();
    const plan = path.join(dir, 'docs/plans/2026-08-19-parsed.md');
    fs.writeFileSync(plan, [
      '# Parsed', '', '## Status', '',
      '- **Phase:** Draft',
      '- **Type:** feature',
      field,
      '', '## Changelog', '', '- a plan from an issue', '',
    ].join('\n'), 'utf8');

    const out = execFileSync('bash', [path.join(SCRIPTS, 'plot-plan-meta.sh'), plan], {
      encoding: 'utf8',
    });
    const meta = JSON.parse(out.trim()) as { issues: number[]; phase: string };
    assert.deepEqual(meta.issues, [228], 'the parser must read the issue number back');
    // And the phase the same parser reports is the one the DoD names.
    assert.equal(meta.phase, 'draft');
  });

  it('quotes the issue rather than summarising it', () => {
    const prompt = composeIdeaPrompt({
      issue: ISSUE, slug: 's', type: 'feature', truncated: false,
    });
    // A well-written issue IS the brain dump /plot-idea prefers; a summary here
    // would be a lossy copy between the operator's words and the plan.
    assert.ok(prompt.includes(ISSUE.body));
    assert.ok(prompt.includes(ISSUE.title));
    assert.ok(prompt.includes(ISSUE.url));
  });

  it('states the Type, because unattended /plot-idea stops without one', () => {
    const prompt = composeIdeaPrompt({
      issue: ISSUE, slug: 's', type: 'bug', truncated: false,
    });
    // Measured behaviour, not a guess: /plot-idea's Type question is shape 3
    // (stop, write no plan file) and it explicitly forbids inferring the Type
    // from the title. A click that produced nothing and exited 0 is the silent
    // failure docs/unattended.md exists to document.
    assert.match(prompt, /^Type: bug$/m);
  });

  it('says so when it truncated, rather than letting a fragment read as whole', () => {
    const long = { ...ISSUE, body: 'x'.repeat(BODY_MAX + 10) };
    const prompt = composeIdeaPrompt({
      issue: { ...long, body: long.body.slice(0, BODY_MAX) },
      slug: 's', type: 'feature', truncated: true,
    });
    assert.match(prompt, /truncated/);
    assert.match(prompt, /Read the whole/);
  });
});

describe('an action that cannot work is not offered', () => {
  const refusal = (got: Captured): IdeaRefusal => got.body.reason as IdeaRefusal;

  it('refuses a host that cannot be asked, and does not call it "no issue"', async () => {
    const dir = repo();
    const got = await post({
      repoRoot: dir,
      issue: () => {
        const e = new Error('bitbucket has no issue read') as Error & { code?: number };
        e.code = 4;
        return Promise.reject(e);
      },
    });
    assert.equal(refusal(got), 'tracker-unsupported');
    assert.equal(got.body.ok, false);
    assert.ok(!fs.existsSync(ideaPromptPath(dir, 228)), 'nothing may be written');
  });

  it('refuses a broken lookup as an outage, never as an empty issue', async () => {
    const dir = repo();
    const got = await post({
      repoRoot: dir,
      issue: () => Promise.reject(new Error('HTTP 503: Service Unavailable')),
    });
    // AN OUTAGE IS NOT AN ANSWER, in this direction too: planning against a
    // body nobody returned is the failure the rule exists to remove.
    assert.equal(refusal(got), 'issue-unreadable');
    assert.equal(got.status, 502);
    assert.match(String(got.body.detail), /503/);
    assert.ok(!fs.existsSync(ideaPromptPath(dir, 228)));
  });

  it('refuses when no Idea command is configured, rather than doing nothing', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: '' });
    assert.equal(refusal(got), 'no-idea-command');
    // The refusal NAMES THE FIX. A board that accepted the click and silently
    // did nothing is this repo's recurring defect wearing a button.
    assert.match(String(got.body.detail), /Idea command/);
  });

  it('never runs the `none` sentinel as a command', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, command: 'none' });
    assert.equal(refusal(got), 'no-idea-command');
    // `none` is the repo's established "we do this by hand" answer. Running it
    // would spawn `none: command not found` and log that as the reason.
    assert.equal(usableCommand('none'), '');
    assert.equal(usableCommand('  claude -p  '), 'claude -p');
  });

  it('refuses a second plan for one signal', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, referenced: new Set([228]) });
    assert.equal(refusal(got), 'already-planned');
    assert.ok(!fs.existsSync(ideaPromptPath(dir, 228)));
  });

  it('refuses rather than guessing when the plans cannot be read', async () => {
    const dir = repo();
    const got = await post({ repoRoot: dir, referenced: null });
    // The opposite of `refreshIssues`'s choice, deliberately: an unfiltered
    // LIST is a display error a refresh corrects, while spawning an agent on an
    // unchecked precondition writes a plan file nobody asked for.
    assert.equal(refusal(got), 'already-planned');
    assert.match(String(got.body.detail), /unknown/);
  });

  it('is unavailable off localhost, where the repo is not', () => {
    // THE CAPABILITY FLAG IS UNCHANGED; THE REFUSAL MOVED.
    //
    // `ideaAvailability` still answers *will this control act*, which is what
    // the button asks before it is clicked, and that is asserted here as it
    // always was. What is no longer asserted through `handleIdea` is the 403:
    // since 2026-08-19 the loopback boundary is enforced in the router, ahead
    // of every write route at once, because a check each handler has to
    // remember is a rule while a check where routes are dispatched is a gate.
    //
    // This route is the reason that distinction is not academic. It landed on
    // the default branch while the gate was being written and, under the
    // list-of-paths shape the gate started with, would have merged cleanly and
    // been the one ungated write endpoint.
    //
    // The refusal itself is asserted end-to-end over every write route in
    // `test/write-gate.test.mjs`, including that a refused request spawned
    // nothing — which is the assertion that matters and which calling a
    // handler directly cannot make.
    assert.equal(ideaAvailability('0.0.0.0').available, false);
    assert.match(ideaAvailability('0.0.0.0').reason, /not localhost/);
    assert.equal(ideaAvailability('localhost').available, true);
    assert.equal(writeGate('0.0.0.0', {}).allowed, false, 'and the gate refuses it');
  });
});

describe('the request names a record; it does not carry one', () => {
  it('takes only a number, and reads the issue itself', async () => {
    const dir = repo();
    // A caller supplying its own title and body must not have them used: no
    // text a page holds may become the problem statement an agent acts on.
    await post({
      repoRoot: dir,
      body: { number: 228, type: 'feature', title: 'INJECTED', body: 'INJECTED BODY' },
    });
    const prompt = fs.readFileSync(ideaPromptPath(dir, 228), 'utf8');
    assert.ok(!prompt.includes('INJECTED'), 'caller-supplied text must be ignored');
    assert.ok(prompt.includes(ISSUE.title), 'the host is what says what the issue is');
  });

  it('rejects a number that is not one', async () => {
    const dir = repo();
    for (const bad of [{ number: '../../etc/passwd' }, { number: -1 }, { number: 0 }, {}]) {
      const got = await post({ repoRoot: dir, body: { ...bad, type: 'feature' } });
      assert.equal(got.status, 400, `${JSON.stringify(bad)} must be refused`);
    }
  });

  it('rejects a Type the skill does not define', async () => {
    const dir = repo();
    // An unrecognised Type would reach the plan file and drive a wrong version
    // bump — and /plot-idea forbids inferring it, so passing it through would
    // be worse than refusing.
    const got = await post({ repoRoot: dir, body: { number: 228, type: 'chore' } });
    assert.equal(got.status, 400);
    assert.match(String(got.body.error), /feature, bug, docs or infra/);
  });

  it('keeps an issue body out of the shell, whatever it contains', async () => {
    const dir = repo();
    const nasty = { ...ISSUE, body: '"; rm -rf ~ #\n$(touch /tmp/plot-pwned)\n`id`' };
    await post({ repoRoot: dir, issue: nasty });
    // The body reached the repo as a FILE. Its path is what travels, so no part
    // of an issue is ever a shell word — the property `continue.ts` documents
    // for the same reason, and the one that matters more here because anyone
    // who can file an issue writes this text.
    const promptPath = ideaPromptPath(dir, 228);
    assert.ok(fs.readFileSync(promptPath, 'utf8').includes('rm -rf ~'));
    assert.ok(!fs.existsSync('/tmp/plot-pwned'), 'nothing in a body may execute');
  });
});

describe('the proposed slug matches the name the row already showed', () => {
  it('agrees with the row, so a click cannot rename what it promised', () => {
    // The row renders `inferredPlanName(title)`; this proposes the slug. They
    // are separate functions on purpose — a server module reaching into `app/`
    // would couple the route to the renderer — so this test is what keeps them
    // from drifting.
    assert.equal(
      slugFromTitle('Board: one PR refresh costs three calls', 1),
      'one-pr-refresh-costs-three-calls',
    );
    assert.equal(
      slugFromTitle('The fleet scan asks once, not once per branch', 1),
      'the-fleet-scan-asks-once-not',
    );
  });

  it('falls back to the number when a title slugs to nothing', () => {
    // A name is still needed, and the number is the one fact always present and
    // always unique.
    assert.equal(slugFromTitle('!!! ???', 42), 'issue-42');
  });
});

describe('the round trip: the plan removes the row that produced it', () => {
  /**
   * THE DoD's CENTRAL ASSERTION, and it is a round trip rather than two halves.
   *
   * The failure this guards against is specific and was the whole reason
   * `an-issue-is-a-signal` exists: a plan that answers an issue while the issue
   * still sits in the inbox beside it. Asserting the prompt "mentions the
   * issue" would not catch it — the row disappears only if the FIELD SYNTAX is
   * one `plot-plan-meta.sh` reads, so the test writes a plan the way the prompt
   * instructs, then asks the parser, then asks the filter.
   */
  it('a plan built from the prompt is read back as referencing the issue', async () => {
    const dir = repo();
    await post({ repoRoot: dir });
    const prompt = fs.readFileSync(ideaPromptPath(dir, 228), 'utf8');

    // Follow the prompt's instruction literally — the field, exactly as it asks
    // for it — rather than writing what this test knows the parser wants.
    const asked = prompt
      .split('\n')
      .find((l) => l.includes('**Issue:**'))!
      .replace(/^\s*\d+\.\s*Record\s*/, '')
      .replace(/`/g, '')
      .replace(/\s+in the plan's.*$/, '')
      .trim();

    fs.writeFileSync(path.join(dir, 'docs/plans/2026-08-19-from-the-prompt.md'), [
      '# From the prompt', '', '## Status', '',
      '- **Phase:** Draft',
      '- **Type:** feature',
      asked,
      '', '## Changelog', '', '- the plan the action produced', '',
    ].join('\n'), 'utf8');

    // The SAME question the board asks on every refresh, through the same
    // parser. `referencedIssues` here mirrors `fleet.ts`'s — both read the
    // `issues` array `plot-plan-meta.sh` emits from the `Issue:` field.
    const { referencedIssues } = await import('../../src/server/idea.js');
    const referenced = await referencedIssues({ repoRoot: dir, scriptsDir: SCRIPTS });
    assert.ok(referenced, 'the plans must be readable');
    assert.ok(
      referenced.has(228),
      'the plan the action produces must remove the row that produced it',
    );

    // And the row is gone: the filter `fleet.ts` applies is exactly this.
    const open = [{ number: 228 }, { number: 227 }];
    const stillUnplanned = open.filter((i) => !referenced.has(i.number)).map((i) => i.number);
    assert.deepEqual(stillUnplanned, [227], '#228 is answered; #227 is not');
  });

  it('a second click on the answered row is refused, not a second plan', async () => {
    // The row survives until the next refresh, so the click is reachable. The
    // precondition is what makes two plans for one signal impossible — worse
    // than the row that prompted them.
    const dir = repo();
    const got = await post({ repoRoot: dir, referenced: new Set([228]) });
    assert.equal(got.body.reason, 'already-planned');
    assert.ok(!fs.existsSync(ideaPromptPath(dir, 228)));
  });
});

describe('the idea does not move the board', () => {
  // THE DEFECT, pinned. `/plot-idea` runs `git checkout -b idea/<slug>`
  // (SKILL.md:250). Spawned with `cwd: repoRoot` — the board's own checkout —
  // that checkout is the one that moves, and the board then serves a branch
  // nobody chose. Measured 2026-08-25: clicking Create plan on issue #333 left
  // the board's worktree on `idea/the-pr-list-join-is-silently` with NO
  // worktree anywhere on main, while the header still read `main`.
  //
  // ASSERTED ON THE FILESYSTEM, because the spawn is not injectable: `IdeaDeps`
  // carries `config`, `issue` and `referenced` and no `spawn`. The worktree the
  // route creates is the observable consequence, and `git worktree list` is a
  // stronger witness than a stubbed argument anyway — it says the checkout
  // really exists and really is somewhere else.
  it('creates a worktree of its own, leaving the board checkout where it was', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-idea-git-'));
    made.push(parent);
    const dir = path.join(parent, 'repo');
    fs.mkdirSync(path.join(dir, 'docs/plans'), { recursive: true });
    // A REAL repository: the guard turns on `rev-parse --git-dir`, and a plain
    // directory has no checkout to displace, so it spawns in place — the path
    // every other test in this file takes.
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@e.st');
    git('config', 'user.name', 'T');
    fs.writeFileSync(path.join(dir, 'README.md'), '# t\n');
    git('add', '-A');
    git('commit', '-qm', 'init');
    const before = execFileSync('git', ['branch', '--show-current'],
      { cwd: dir, encoding: 'utf8' }).trim();

    // THE COMMAND IS `git checkout -b`, so the spawn's cwd is observable: the
    // checkout that runs it is the one that moves. A stub cannot see this
    // (IdeaDeps has no `spawn`), and asserting only that a worktree EXISTS
    // passes even when the agent still runs in the board's checkout — verified
    // by mutation. Making the command itself branch is what discriminates.
    const got = await post({
      repoRoot: dir,
      command: 'git checkout -b idea/moved-here >/dev/null 2>&1 || true; true',
    });
    assert.equal(got.status, 202, JSON.stringify(got.body));
    // The spawn is detached; give it a moment to run its one command.
    await new Promise((r) => setTimeout(r, 700));

    const trees = execFileSync('git', ['worktree', 'list'], { cwd: dir, encoding: 'utf8' });
    assert.match(trees, /plot-idea-issue-228/,
      'the route must add a worktree for the idea');
    assert.equal(
      execFileSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim(),
      before,
      'the board checkout must still be on the branch it started on — if the '
      + 'agent ran here, `git checkout -b` moved it',
    );
  });
});
