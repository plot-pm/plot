import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agentLogDir, agentLogPath } from './agent-log.js';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { readConfig, type BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';

/**
 * Turning an issue into a plan — the row's one action, and the board's FOURTH
 * state-changing route.
 *
 * **It creates a Draft, and that is the whole design rather than a detail.**
 * The row exists because an issue is *not a plan in an earlier state, it is a
 * signal that has not become one yet*, and the decision it asks for is **is
 * this worth planning?** — not *do it*. An action that produced anything past
 * Draft would answer a question the operator has not been asked, which is the
 * one thing the row was built to avoid. So this route reaches `/plot-idea` and
 * stops there; approving stays a separate, deliberate click on the card that
 * appears.
 *
 * **Nothing is written to the tracker. Ever.** No comment, no label, no state
 * change, no close-on-merge. Plot reads the tracker and never writes to it —
 * the plan's own `Issue: #<n>` reference IS the record, one-directional and
 * living in the plan. This module therefore uses exactly one host op,
 * `issue-view`, and it reads. (The manifesto's rule stated as a mechanism: a
 * copy of tracker state ages into a lie, so there is no copy.)
 *
 * **The reference is what makes the row disappear.** `fleet.ts` filters the
 * inbox by the `Issue:` field every plan file carries, so a created plan that
 * omits it leaves the row standing beside the plan that answered it — the exact
 * failure `an-issue-is-a-signal` exists to remove. The prompt therefore states
 * that field as a requirement rather than as a suggestion; see
 * {@link composeIdeaPrompt}.
 *
 * ## The shape is borrowed, not invented
 *
 * The guards are IMPORTED from `dispatch.ts` — availability, the same-origin
 * check, the bounded body reader — for the reason `approve.ts` and
 * `continue.ts` both state: a second copy of a security decision is a second
 * place for it to be weakened. This is the same class of endpoint as those
 * three (it spawns a process on the machine the board runs on), so it is
 * deliberately the same shape and not a fourth one.
 */

/**
 * How the board runs `/plot-idea`. The FOURTH agent-runner key, and a member of
 * an existing family rather than a new mechanism.
 *
 * REQUIRED, unlike `Approve command` — and the asymmetry is the same one that
 * separates `/api/approve` from `/api/continue`. Approving has a script:
 * `plot-approve.sh` performs the mechanical half (merge, flip the phase, fill
 * the record) and refuses everything needing a reader, so the board can fall
 * back to it. Creating a plan has no such script and cannot have one. Every
 * step of `/plot-idea` is judgement — the two ceremony questions, the
 * triage, the slug, the Type, the template — and no script in this repo
 * invokes a skill, because bash cannot reach one at all.
 *
 * So an absent key is a REFUSAL that names itself, never a silent no-op. A
 * board that accepted the click and did nothing would be this repo's recurring
 * defect (an unobserved thing reported as an observed one) wearing a button.
 */
export const IDEA_COMMAND_KEY = 'Idea command';

/**
 * Where the problem statement is written inside the repo, and why it is a FILE.
 *
 * **This is a safety property, not a convenience** — the same one
 * `continue.ts` documents for `.plot-worker.continue.md`. `Idea command` is a
 * shell FRAGMENT run through `sh -c`, so anything interpolated into it is shell
 * source. An issue body is free text written by whoever can file an issue,
 * which on a public tracker is anyone at all; a single `"; rm -rf ~` in it
 * would execute. Writing the statement to a file and naming that file in the
 * ENVIRONMENT means no part of an issue ever becomes a shell word, whatever it
 * contains.
 *
 * Keyed by issue number so two clicks on two rows cannot overwrite each other's
 * statement, and so the file left behind says which issue it was for.
 */
  // OUTSIDE THE REPO, beside the log and the state this command already keeps
  // there — see {@link agentLogDir} for the measurement that put them there.
export function ideaPromptPath(repoRoot: string, number: number): string {
  return agentLogPath(repoRoot, 'idea-issue', number, 'prompt');
}

/** The environment variable naming that file, beside `PLOT_CONTINUATION`. */
export const IDEA_PROMPT_ENV = 'PLOT_IDEA_PROMPT';

/** Where the command's own words go — the neighbourhood `approve` established. */
export function ideaLogPath(repoRoot: string, number: number): string {
  return agentLogPath(repoRoot, 'idea-issue', number, 'log');
}

/** Where the outcome is recorded, so a later GET can read it back. */
function ideaStatePath(repoRoot: string, number: number): string {
  return agentLogPath(repoRoot, 'idea-issue', number, 'state');
}

/**
 * How much of an issue body to carry into the prompt, in characters.
 *
 * A well-written issue is exactly what `/plot-idea` wants — Manifesto Principle
 * 11 names a free-form brain dump as its PREFERRED input — so this is generous
 * where {@link ANSWER_MAX}'s sibling is strict. It is bounded all the same: an
 * issue with a megabyte of pasted logs would fill the agent's context before it
 * read the instruction, and the truncation is STATED in the prompt so the agent
 * knows to open the issue itself rather than planning against a fragment.
 */
export const BODY_MAX = 32 * 1024;

/** Why creating a plan was refused — each sends the reader somewhere different. */
export type IdeaRefusal =
  /** No `Idea command` is configured, so no agent can be started. */
  | 'no-idea-command'
  /** This host has no issue read at all (Bitbucket) — see `plot-host.sh` exit 4. */
  | 'tracker-unsupported'
  /** The issue could not be read. NOT the same as "it has no body". */
  | 'issue-unreadable'
  /** A plan already references this issue — the row is answered already. */
  | 'already-planned';

export interface IdeaOptions extends BuildBoardOptions {
  /** The interface the server bound to (`HOST`), verbatim. */
  host: string;
  port: number;
}

/**
 * Whether the route will act, and why not — the answer the button needs BEFORE
 * it is clicked, for the reason `dispatchAvailability` exists.
 *
 * Its own function rather than a re-export of `dispatchAvailability`, which is
 * the lesson `approve.ts` records: today all four capabilities answer the same
 * binding question, and one flag for several capabilities is precisely how they
 * diverge without anyone noticing.
 *
 * Over a non-localhost binding this is unavailable, and that is CORRECT rather
 * than a gap: creating a plan spawns an agent that writes to this disk, and a
 * Tailscale address is deliberately not localhost. The phone that reads the
 * board does not plan from it.
 */
export function ideaAvailability(host: string): { available: boolean; reason: string } {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return { available: true, reason: '' };
  }
  return {
    available: false,
    reason: `the board is bound to ${host}, not localhost — turning an issue into a plan is available only on the machine that owns the repo`,
  };
}

/**
 * The runnable command, or "" — the ONE place the `none` sentinel is honoured.
 *
 * `none` is the repo's established answer for *asked, and we do this by hand*
 * (`Worker command: none`, `Implementation home: none`). It is a DELIBERATE
 * absence, distinct from a missing key, and it must never be RUN — which is
 * exactly what a bare emptiness check would do, spawning `none: command not
 * found` and logging that as the reason a plan does not exist.
 *
 * A pure function of the string so the route and the test agree by
 * construction rather than by both remembering the sentinel.
 */
export function usableCommand(configured: string): string {
  const cmd = (configured || '').trim();
  return cmd === 'none' || cmd === 'NONE' || cmd === 'None' ? '' : cmd;
}

/** Read the configured command, or "" — the one place that key is looked up. */
export function ideaCommand(opts: BuildBoardOptions): string {
  return usableCommand(readConfig(opts, IDEA_COMMAND_KEY, ''));
}

/** One issue, as the host reports it. */
export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  url: string;
}

/**
 * Read ONE issue from the host, body included.
 *
 * Per click, never per refresh — the cost note the plan attached to this
 * feature. `issue-list` runs on the 60 s PR timer and deliberately omits
 * bodies; this asks for exactly the one issue a human just pointed at, at a
 * cadence no timer sets.
 *
 * Rejects with `code` preserved so the caller can keep exit 4 (this host cannot
 * be asked) apart from every other failure — the same split `refreshIssues`
 * makes, and the reason the codes were reused.
 */
export function readIssue(
  opts: BuildBoardOptions,
  number: number,
): Promise<IssueDetail> {
  return new Promise((resolve, reject) => {
    execFile(
      'bash',
      [path.join(opts.scriptsDir, 'plot-host.sh'), 'issue-view', String(number)],
      { cwd: opts.repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            (stderr || '').trim() || err.message,
          ) as Error & { code?: number | string };
          e.code = (err as { code?: number | string }).code;
          reject(e);
          return;
        }
        try {
          const raw = JSON.parse(stdout) as Partial<IssueDetail>;
          resolve({
            number: typeof raw.number === 'number' ? raw.number : number,
            title: raw.title ?? '',
            body: raw.body ?? '',
            url: raw.url ?? '',
          });
        } catch {
          // A parse failure is a FAILURE, never an empty issue. Planning
          // against a body the adapter did not actually return is the shape of
          // error this repo keeps removing.
          reject(new Error('the host returned something that is not an issue'));
        }
      },
    );
  });
}

/**
 * The prompt handed to `/plot-idea`: the issue as a problem statement, plus the
 * three facts that would otherwise go unstated and silently produce nothing.
 *
 * **The issue is QUOTED, never summarised.** `/plot-idea` takes a free-form
 * brain dump as its preferred input, and a well-written issue already is one —
 * this repo's own #226-#228 carried request counts, timings, file paths and
 * line numbers. Summarising here would put a lossy copy between the operator's
 * words and the plan, which is the same mistake as mirroring tracker state one
 * layer up.
 *
 * Three instructions ride with it, and each answers a measured failure:
 *
 * 1. **`Issue: #<n>` in the Status block.** The field `fleet.ts` reads to make
 *    the row disappear. Stated as a requirement because a plan that omits it
 *    leaves its own signal sitting in the inbox — the failure this plan exists
 *    to remove, reintroduced by the thing that was supposed to fix it.
 *
 * 2. **The Type, given rather than asked.** `/plot-idea` unattended STOPS
 *    without one and writes no plan file — deliberately, since Type drives
 *    release notes and the version bump and inferring it from a title is the
 *    one thing that skill forbids. A click that produced nothing and exited 0
 *    is the silent failure `docs/unattended.md` was written about. So the
 *    caller states it, and the board says which one it stated.
 *
 * 3. **Draft, and stop.** Named twice — here and in the route's contract —
 *    because it is the property the whole row rests on.
 */
export function composeIdeaPrompt(input: {
  issue: IssueDetail;
  slug: string;
  type: string;
  truncated: boolean;
}): string {
  const { issue, slug, type, truncated } = input;
  const parts: string[] = [];

  parts.push(
    `/plot-idea ${slug}: ${issue.title || `issue #${issue.number}`}`,
    '',
    `Type: ${type}`,
    '',
    'This plan comes from a tracker issue somebody decided was worth planning.',
    'The issue below is the problem statement — read it as the brain dump',
    '`/plot-idea` prefers, not as a specification to copy into the plan.',
    '',
  );

  parts.push(
    '## Two things this plan must do',
    '',
    // The load-bearing instruction. See the header.
    `1. Record \`- **Issue:** #${issue.number}\` in the plan's \`## Status\` block.`,
    '   That field is how the board knows this signal has become a plan; without',
    '   it the issue stays in the inbox beside the plan that answered it.',
    '2. Stop at **Draft**. Do not approve it, and do not start implementing it —',
    '   whether this is worth doing is the decision the reader makes next, and',
    '   creating anything past Draft would make it for them.',
    '',
    'Write nothing to the tracker: no comment, no label, no state change. The',
    "plan's `Issue:` reference is the only link, and it points one way.",
    '',
  );

  parts.push(
    `## Issue #${issue.number}${issue.url ? ` — ${issue.url}` : ''}`,
    '',
    `**${issue.title}**`,
    '',
    issue.body.trim() || '_The issue has no body — its title is the whole of it._',
    '',
  );

  if (truncated) {
    parts.push(
      `_This issue's body was truncated at ${BODY_MAX} characters. Read the whole_`,
      '_issue on the tracker before deciding anything that turns on its detail._',
      '',
    );
  }

  return parts.join('\n');
}

/**
 * A plan slug proposed from the issue, and deliberately the SAME string the row
 * already shows.
 *
 * The row renders `inferredPlanName(title)` in the plan track, and a click that
 * produced a differently-named plan would make the row a liar about its own
 * action. `/plot-idea` may still choose otherwise — it has the whole problem
 * statement and this has six words of a title — and that is fine: this is the
 * proposal the operator saw, not a decision.
 *
 * Kept in the SERVER rather than imported from the component for the reason
 * `briefPathFor` states about its own duplication: a server module reaching
 * into `app/` to share a slug function would couple the route to the renderer.
 * They agree by construction instead — both truncate to six words — and the
 * unit test asserts the two produce the same string, so a drift fails loudly.
 */
export function slugFromTitle(title: string, number: number): string {
  const slug = title
    .toLowerCase()
    .replace(/^[a-z0-9 ]{1,20}:\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const words = slug.split('-').filter(Boolean).slice(0, 6).join('-');
  // A title with nothing sluggable still needs a name, and the issue number is
  // the one fact that is always there and always unique.
  return words || `issue-${number}`;
}

/**
 * What the board may say about a plan it asked for — the same four states
 * `ApproveState` carries, for the same reason.
 *
 * `unknown` is not a degraded `failed`: nothing has been attempted for that
 * issue, and painting a message on a row whose button was never pressed would
 * be the board asserting something it does not know.
 */
export type IdeaState = 'unknown' | 'running' | 'done' | 'failed';

export interface IdeaStatus {
  state: IdeaState;
  /** The command's own last words — empty while running and on success. */
  message: string;
  /** Where the full transcript is, for anything the row cannot hold. */
  log: string;
}

/**
 * The tail of the log, as a message for a row. The same bound and the same
 * reasoning as `approve.ts`'s — the last lines, because a command that explains
 * itself does so on the way out.
 *
 * Its own copy rather than an import across modules that do not otherwise know
 * each other; four lines, and the alternative is a shared util nobody owns.
 */
export function lastLines(text: string, max = 3, maxChars = 400): string {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const tail = lines.slice(-max).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}

/** Read back what an earlier POST started. Never spawns, never blocks. */
export function ideaStatus(opts: BuildBoardOptions, number: number): IdeaStatus {
  const log = ideaLogPath(opts.repoRoot, number);
  const statePath = ideaStatePath(opts.repoRoot, number);
  let recorded = '';
  try {
    recorded = fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    return fs.existsSync(log)
      ? { state: 'running', message: '', log }
      : { state: 'unknown', message: '', log };
  }
  if (recorded === '0') return { state: 'done', message: '', log };
  let text = '';
  try {
    text = fs.readFileSync(log, 'utf8');
  } catch {
    /* the log is gone; the exit code still stands */
  }
  return {
    state: 'failed',
    message: lastLines(text) || `the idea command exited ${recorded}`,
    log,
  };
}

/**
 * The issue numbers every plan in the repo references — the SAME question
 * `fleet.ts`'s `referencedIssues` answers, asked here for a different purpose.
 *
 * There it filters a list on a timer; here it is a PRECONDITION on a write. A
 * second click on a row the board has not yet refreshed away would otherwise
 * start a second `/plot-idea` for an issue that already has a plan, and two
 * plans answering one signal is worse than the row that prompted them.
 *
 * Null on any failure, and the caller then REFUSES rather than proceeding. That
 * is the opposite of `refreshIssues`'s choice, deliberately: reporting an
 * unfiltered list is a display error that a refresh corrects, while spawning an
 * agent on an unchecked precondition writes a plan file nobody asked for.
 */
export async function referencedIssues(
  opts: BuildBoardOptions,
): Promise<Set<number> | null> {
  const planDir = readConfig(opts, 'Plan directory', 'docs/plans/');
  const dir = path.join(opts.repoRoot, planDir);
  let files: string[];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try { return fs.statSync(f).isFile(); } catch { return false; }
      });
  } catch {
    return null;
  }
  if (files.length === 0) return new Set();
  return new Promise((resolve) => {
    execFile(
      'bash',
      [path.join(opts.scriptsDir, 'plot-plan-meta.sh'), ...files],
      { cwd: opts.repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const referenced = new Set<number>();
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue;
          try {
            const meta = JSON.parse(line) as { issues?: number[] };
            for (const n of meta.issues ?? []) referenced.add(n);
          } catch {
            /* one unparseable record is not a reason to discard the rest */
          }
        }
        resolve(referenced);
      },
    );
  });
}

/** The two facts this route reads from outside itself, injectable for test. */
export interface IdeaDeps {
  /** The configured `Idea command`. */
  config?: (opts: BuildBoardOptions, key: string, fallback: string) => string;
  /** The host's account of one issue. */
  issue?: (opts: BuildBoardOptions, number: number) => Promise<IssueDetail>;
  /** Which issues the plan estate already answers. */
  referenced?: (opts: BuildBoardOptions) => Promise<Set<number> | null>;
}

/**
 * Handle `POST /api/idea` — refuse, or write the problem statement and spawn
 * `/plot-idea` on it.
 *
 * Detached and answered 202 immediately, for the reason `/api/approve`
 * documents: this server is single-threaded, and awaiting an agent would freeze
 * every viewer's board for the length of somebody else's click. The outcome is
 * read back from `GET /api/idea/<number>` — and the ROW DISAPPEARING is the
 * real confirmation, derived from git on the next refresh rather than asserted
 * from this reply.
 *
 * ## What it refuses, and why each refusal exists
 *
 * | refusal | because |
 * |---|---|
 * | not localhost | it spawns an agent that writes to this disk |
 * | cross-origin | any page can POST to localhost; the binding cannot cover that |
 * | `tracker-unsupported` | a host with no issue read cannot answer, and an action that cannot work must not be offered |
 * | `issue-unreadable` | an outage is not an answer — planning against a body nobody returned is the failure this repo keeps removing |
 * | `no-idea-command` | no script can do `/plot-idea`'s job; accepting the click and doing nothing is the silent failure |
 * | `already-planned` | two plans answering one signal is worse than the row |
 */
export async function handleIdea(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: IdeaOptions,
  deps: IdeaDeps = {},
): Promise<void> {
  const readCfg = deps.config ?? readConfig;
  const readOne = deps.issue ?? readIssue;
  const readReferenced = deps.referenced ?? referencedIssues;
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, reason: IdeaRefusal, number: number, detail: string) =>
    json(status, { ok: false, number, reason, detail });

  // The same-origin gate, imported rather than reimplemented. The loopback gate
  // that used to sit above it is enforced in the router for every write route at
  // once — see `write-gate.ts`, and the note in `handleDispatch` for why one
  // surviving copy would have made the named opt-in mean different things on
  // different routes.
  //
  // `ideaAvailability` still answers this control's capability flag, which is
  // the question the BUTTON asks before it is clicked.
  if (!isSameOrigin(req, opts.port)) {
    json(403, { error: 'cross-origin request refused' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    json(400, { error: err instanceof Error ? err.message : String(err) });
    return;
  }

  // THE NUMBER IS THE WHOLE REQUEST. The title, the body and the URL are read
  // from the host by this server — never taken from the caller — so no text a
  // page supplies can become the problem statement an agent acts on. The same
  // rule `handleContinue` follows with the branch: the request names a record,
  // it does not carry one.
  const raw = (body as { number?: unknown })?.number;
  const number = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(number) || number <= 0) {
    json(400, { error: 'number must be a positive issue number' });
    return;
  }

  // The Type, which the caller states because `/plot-idea` unattended stops
  // without one. Bounded to the four the skill defines rather than passed
  // through: an unrecognised Type would reach the plan file and drive a wrong
  // version bump, and the skill explicitly forbids inferring it.
  const typeRaw = (body as { type?: unknown })?.type;
  const type = typeof typeRaw === 'string' ? typeRaw : 'feature';
  if (!['feature', 'bug', 'docs', 'infra'].includes(type)) {
    json(400, { error: 'type must be feature, bug, docs or infra' });
    return;
  }

  // ASKED BEFORE ANYTHING IS READ OR WRITTEN. A repo with no runner cannot act
  // on this click at all, and finding that out after fetching an issue would
  // spend a host call to reach the same refusal.
  const usable = usableCommand(readCfg(opts, IDEA_COMMAND_KEY, ''));
  if (!usable) {
    refuse(
      409,
      'no-idea-command',
      number,
      `no \`${IDEA_COMMAND_KEY}\` in Plot Config — creating a plan runs the /plot-idea SKILL, which no script can do; add the key or run /plot-idea yourself`,
    );
    return;
  }

  // ALREADY ANSWERED? Checked before the host call, because it needs no network
  // and a row the board has not yet refreshed away is the likeliest second
  // click.
  const referenced = await readReferenced(opts);
  if (referenced === null) {
    refuse(
      409,
      'already-planned',
      number,
      'the plans could not be read, so whether this issue already has one is unknown — refusing rather than risking a second plan for one signal',
    );
    return;
  }
  if (referenced.has(number)) {
    refuse(
      409,
      'already-planned',
      number,
      `a plan already references #${number} — the row is answered and will go on the next refresh`,
    );
    return;
  }

  let issue: IssueDetail;
  try {
    issue = await readOne(opts, number);
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    const detail = err instanceof Error ? err.message : String(err);
    if (code === 4) {
      // The standing fact, not an outage: this host has no issue read at all.
      // The button is not offered in this case — see `IssueRowView` — so
      // reaching here means the board and the host disagree, and saying which
      // is the only useful answer.
      refuse(409, 'tracker-unsupported', number, detail ||
        'this host has no issue read, so an issue cannot become a plan from here');
      return;
    }
    refuse(502, 'issue-unreadable', number, detail ||
      `issue #${number} could not be read — an outage is not an answer, so nothing was created`);
    return;
  }

  const truncated = issue.body.length > BODY_MAX;
  const prompt = composeIdeaPrompt({
    issue: truncated ? { ...issue, body: issue.body.slice(0, BODY_MAX) } : issue,
    slug: slugFromTitle(issue.title, issue.number),
    type,
    truncated,
  });

  const promptPath = ideaPromptPath(opts.repoRoot, number);
  try {
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, prompt, 'utf8');
  } catch (err) {
    json(500, {
      error: `cannot write ${promptPath}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const log = ideaLogPath(opts.repoRoot, number);
  const statePath = ideaStatePath(opts.repoRoot, number);
  let out: number;
  try {
    // Truncated, not appended — this log is read back AS the answer, and an
    // appended one would show a previous attempt's error after a later
    // success. The same choice `approve.ts` makes, for the same reason.
    fs.rmSync(statePath, { force: true });
    out = fs.openSync(log, 'w');
  } catch (err) {
    json(500, { error: `cannot open ${log}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Through `sh -c` because `Idea command` is a shell FRAGMENT, the same
  // interpretation `Worker command` and `Approve command` get. NOTHING from the
  // issue is interpolated into that string: the problem statement reached the
  // repo as a file, and its PATH travels in the environment. The prompt is
  // passed as ONE argument via `"$@"` — already the shape `approve.ts` uses,
  // and here it carries only a path this server itself composed.
  // ITS OWN WORKTREE, because `/plot-idea` CHECKS OUT the branch it creates
  // (`git checkout -b idea/<slug>`, SKILL.md:250). Run in the board's own
  // checkout — which is what `cwd: opts.repoRoot` meant — that checkout is the
  // one that moves, and the board then serves a branch it did not choose.
  //
  // Measured 2026-08-25: clicking *Create plan* on issue #333 left the board's
  // worktree on `idea/the-pr-list-join-is-silently` with NO worktree anywhere on
  // `main`. The header still read `main` — it is computed once at startup — so
  // the one display a reader is told to trust when a row looks wrong was the
  // display that had gone stale. A row then inherited that branch's PR and
  // offered *Review* for a PR the agent had not opened.
  //
  // The other spawning routes keep `opts.repoRoot` and are right to: approve,
  // deliver and reslice edit plan files on the default branch and change no
  // checkout. `idea` is the one that moves HEAD, so it is the one that needs
  // somewhere else to stand.
  //
  // FAILING TO MAKE ONE IS A REFUSAL, not a fallback to the board's checkout.
  // Spawning into `repoRoot` is exactly the defect above; doing it silently
  // when a worktree could not be made would reintroduce it on the rarer path,
  // which is the path nobody watches.
  // THE DEFAULT BRANCH by the chain `board.ts` already settled on — configured
  // `Main branch` first, then origin's symbolic ref, then `main`. Not
  // `origin/HEAD` directly: that ref is unset in a fresh clone, and not
  // `plot-host.sh default-branch`, which shells out to `gh repo view`.
  const configured = readConfig(opts, 'Main branch', '');
  const base = configured || (() => {
    try {
      return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: opts.repoRoot, encoding: 'utf8' }).trim().replace(/^origin\//, '') || 'main';
    } catch { return 'main'; }
  })();

  // ONLY WHERE THERE IS A WORKTREE TO MOVE. `git worktree add` needs a git
  // repository; a caller whose repoRoot is a plain directory — every unit test
  // here builds one — has no checkout for `/plot-idea` to displace, so there is
  // nothing to protect it from. Spawning in place is then correct rather than
  // a fallback, and the distinction is measurable: `rev-parse --git-dir`
  // answers it without a network or a remote.
  const isGitRepo = (() => {
    try {
      execFileSync('git', ['rev-parse', '--git-dir'],
        { cwd: opts.repoRoot, stdio: 'ignore' });
      return true;
    } catch { return false; }
  })();

  const ideaTree = isGitRepo
    ? path.join(agentLogDir(opts.repoRoot), `plot-idea-issue-${number}`)
    : opts.repoRoot;
  if (isGitRepo) try {
    // Detached, so the tree holds no branch of its own — `/plot-idea` creates
    // and checks out `idea/<slug>` here, and a detached start leaves it free to.
    fs.rmSync(ideaTree, { recursive: true, force: true });
    execFileSync('git', ['worktree', 'prune'], { cwd: opts.repoRoot });
    // `origin/<base>` where the remote is there, HEAD otherwise. A repo with no
    // remote is an ordinary case — a fresh `git init`, an offline clone — and
    // `origin/main` is simply an invalid reference there, not a signal of
    // trouble. HEAD gives the new tree the same commit the board is already
    // serving, which is what `origin/<base>` approximates when a remote exists.
    const start = (() => {
      try {
        execFileSync('git', ['rev-parse', '--verify', `origin/${base}`],
          { cwd: opts.repoRoot, stdio: 'ignore' });
        return `origin/${base}`;
      } catch { return 'HEAD'; }
    })();
    execFileSync('git', ['worktree', 'add', '--detach', ideaTree, start], {
      cwd: opts.repoRoot,
      stdio: 'ignore',
    });
  } catch (err) {
    // A REFUSAL, not a fallback to the board's checkout. Spawning into
    // `repoRoot` in a real repo is precisely the defect this exists to stop;
    // doing it silently when the worktree could not be made would reintroduce
    // it on the rarer path — the one nobody watches.
    json(500, {
      error: `cannot make a worktree for the idea: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  const child = spawn(
    'sh',
    ['-c', `${usable} "$@"`, 'plot-idea', `Read ${promptPath} and follow it.`],
    {
      cwd: ideaTree,
      detached: true,
      stdio: ['ignore', out, out],
      env: {
        ...process.env,
        // THE DECLARATION, not a switch. There is nobody at this board to
        // answer `AskUserQuestion`, and under `claude -p` that tool is not even
        // registered — so a skill that improvises here exits 0 having written
        // nothing. Setting it makes each skipped question take the shape its
        // author chose and name itself in the log.
        PLOT_UNATTENDED: '1',
        [IDEA_PROMPT_ENV]: promptPath,
        PLOT_ISSUE: String(number),
      },
    },
  );
  child.on('exit', (code, signal) => {
    try {
      fs.writeFileSync(statePath, String(signal ? `signal ${signal}` : code ?? 1), 'utf8');
    } catch {
      /* the state file is a convenience; the log is the record */
    }
  });
  child.on('error', (err) => {
    console.error('idea failed to spawn:', err);
    try {
      fs.appendFileSync(log, `\n${err.message}\n`, 'utf8');
      fs.writeFileSync(statePath, '1', 'utf8');
    } catch {
      /* nothing further to do */
    }
  });
  // `detached` WITHOUT `unref`, exactly as `approve.ts` is and for its reason:
  // detached keeps a Ctrl-C in the board's terminal off the agent, and keeping
  // the handle keeps the exit listener above alive — dropping it would make
  // every creation read as `running` forever.
  fs.closeSync(out);

  json(202, { ok: true, number, prompt: promptPath, log });
}
