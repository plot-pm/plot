import {
  describe,
  it,
  expect,
  afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inferredPlanName,
} from '../../src/app/components/AgentList.js';
import { ageLabel } from '../../src/app/lib/agent-rows/row-identity.js';
import { FleetSchema, IssueRowSchema, issueKey } from '../../src/contract/schema.js';
import { refreshIssues, freshCacheEntry } from '../../src/server/fleet.js';
import { rmTree } from '../helpers.mjs';

/**
 * An issue is a signal the board can see — the decisions that reduce to
 * functions and to the contract.
 *
 * What only a rendered page can settle (the name is not an anchor, the branch
 * column is empty, a numberless host renders plain text) lives in
 * `test/integration/unplanned-issues.browser.test.ts`.
 */

describe('inferredPlanName — a proposal, not a promise', () => {
  it('slugs a title the way this repo names plans', () => {
    expect(inferredPlanName('The fleet scan asks once, not once per branch'))
      .toBe('the-fleet-scan-asks-once-not');
  });

  it('drops a tracker area prefix, which says nothing about the work', () => {
    // "Board: one PR refresh costs three Bitbucket calls" — the real title of
    // #226, whose first word is the area rather than the subject.
    expect(inferredPlanName('Board: one PR refresh costs three calls'))
      .toBe('one-pr-refresh-costs-three-calls');
  });

  it('truncates without an ellipsis — nothing longer exists to point at', () => {
    const name = inferredPlanName('one two three four five six seven eight');
    expect(name).toBe('one-two-three-four-five-six');
    expect(name).not.toContain('…');
  });

  it('returns empty for a title with nothing sluggable, rather than punctuation', () => {
    expect(inferredPlanName('!!! ???')).toBe('');
  });
});

describe('ageLabel — one formatter, so two row kinds cannot disagree', () => {
  it('says minutes, hours and days the way a branch row does', () => {
    expect(ageLabel(45)).toBe('45m');
    expect(ageLabel(120)).toBe('2h');
    expect(ageLabel(60 * 24 * 3)).toBe('3d');
  });
});

describe('the contract keeps the three answers apart', () => {
  it('defaults to unsupported, never to answered', () => {
    // THE LOAD-BEARING DEFAULT. An older server sends no issues and no answer;
    // reading that silence as `answered` would render an empty inbox as a clear
    // one, from a server that was never asked.
    const fleet = FleetSchema.parse({
      generatedAt: '2026-08-19T00:00:00Z', ageSeconds: 1, ready: true, error: null,
      rows: [],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(fleet.issueAnswer).toBe('unsupported');
    expect(fleet.issues).toEqual([]);
    expect(fleet.issueError).toBeNull();
  });


  it('an issue key is a string — a Jira key survives the contract', () => {
    // `plot-host.sh` projects `number: .key`, so a Jira arm puts `PROJ-123` on
    // the wire. `z.number()` rejected it, which is the type half of the defect:
    // the entity docstring already said "an opaque string" and four consumers
    // said otherwise.
    const issue = IssueRowSchema.parse({ number: 'PROJ-123', title: 'A ticket' });
    expect(issue.number).toBe('PROJ-123');
  });

  it('a GitHub number arrives as a string, losslessly', () => {
    // `123` and `"123"` name the same issue. The host emits a JSON number for
    // GitHub and a quoted key for Jira, so the contract coerces the one form
    // that is lossless rather than rejecting half the hosts.
    const issue = IssueRowSchema.parse({ number: 849, title: 'A signal' });
    expect(issue.number).toBe('849');
  });


  it('an issue whose host gave no url carries "", not a guess', () => {
    const issue = IssueRowSchema.parse({ number: 228, title: 'A signal' });
    expect(issue.url).toBe('');
    // Null rather than 0: 0 would claim the issue was opened this instant.
    expect(issue.ageMinutes).toBeNull();
  });

  it('carries the tracker\'s own word and its category, both', () => {
    // Neither substitutes for the other: *Internal Approving* is what a person
    // reads and is per-workflow, while `In Progress` is the stable vocabulary a
    // board could group on. Collapsing them loses one job or the other.
    const issue = IssueRowSchema.parse({
      number: 'PROJ-123', title: 'A ticket',
      status: 'Internal Approving', statusCategory: 'In Progress',
    });
    expect(issue.status).toBe('Internal Approving');
    expect(issue.statusCategory).toBe('In Progress');
  });

  it('accepts an empty statusCategory as an ANSWER, not a failure', () => {
    // `plot-host.sh` gives Bitbucket's `ON HOLD`, `INVALID`, `DUPLICATE` and
    // `WONTFIX` the empty string deliberately: they are terminal without being
    // done, and filing a `WONTFIX` as `Done` puts abandoned work beside
    // finished work. The contract must carry that, not reject or fill it.
    const issue = IssueRowSchema.parse({
      number: 7, title: 'Will not fix', status: 'WONTFIX', statusCategory: '',
    });
    expect(issue.status).toBe('WONTFIX');
    expect(issue.statusCategory).toBe('');
  });

  it('defaults both to "" so a payload predating the fields still parses', () => {
    // The rule `url` and `ageMinutes` already follow. A server that has not
    // been rebuilt must not make the whole fleet payload unparseable — and the
    // renderer answers `''` rather than inventing a word for it.
    const issue = IssueRowSchema.parse({ number: 228, title: 'A signal' });
    expect(issue.status).toBe('');
    expect(issue.statusCategory).toBe('');
  });
});

describe('issueKey — one normalisation, so the two sides cannot disagree', () => {
  it('makes a GitHub number and its string form compare equal', () => {
    // The host emits a JSON number; a plan records `#849` which the parser
    // emits as a number too — but a Jira plan records a quoted key. Both sides
    // pass through here so the comparison is string-to-string either way.
    expect(issueKey(849)).toBe(issueKey('849'));
  });

  it('leaves a Jira key exactly as the tracker spells it', () => {
    // `PROJ-123` has no integer form at all, which is why the type is
    // unfixable in the other direction.
    expect(issueKey('PROJ-123')).toBe('PROJ-123');
  });

  it('never coerces a key to NaN', () => {
    // `Number('PROJ-123')` is NaN, and a Set of NaN matches nothing — a filter
    // that never fires, which is exactly the behaviour being fixed.
    expect(issueKey('PROJ-123')).not.toBe('NaN');
    expect(Number.isNaN(Number(issueKey('PROJ-123')))).toBe(true);
  });
});

describe('the inbox drains — the assertion a type-only change would pass without', () => {
  /**
   * The rule that makes the inbox an inbox: open tracker issues no plan
   * references. Stated here as the set membership it reduces to, because that
   * is the comparison `refreshIssues` performs and the one that silently never
   * matched.
   */
  const unreferenced = (
    open: (string | number)[],
    referenced: (string | number)[],
  ) => {
    const seen = new Set(referenced.map(issueKey));
    return open.filter((n) => !seen.has(issueKey(n)));
  };

  it('a Jira ticket answered by a plan LEAVES the inbox', () => {
    // The whole point. `PROJ-123` from the host against `PROJ-123` from the
    // plan: before this change the plan side was absent and the host side was
    // compared against a Set<number>, so it never matched and the ticket sat
    // in the inbox through deliver and release.
    expect(unreferenced(['PROJ-123', 'PROJ-9'], ['PROJ-123'])).toEqual(['PROJ-9']);
  });

  it('a GitHub issue still drains — the regression this could most easily cause', () => {
    // `849` from the host, `849` from the parser, both through issueKey.
    expect(unreferenced([849, 850], [849])).toEqual([850]);
  });

  it('a plan referencing nothing drains nothing — absent is not false', () => {
    expect(unreferenced([849, 'PROJ-1'], [])).toEqual([849, 'PROJ-1']);
  });
});

describe('entry.waiting — set beside entry.issues, not derived from its capped value', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmTree(dir);
  });

  /**
   * A scripts directory whose `plot-host.sh` answers `account` with `login`,
   * `issue-list --paged` with `n` unassigned open rows (closed answers
   * empty), and every other op with nothing.
   */
  const fixture = (n: number, login = 'jwloka'): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waiting-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    const write = (name: string, body: string) => {
      fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
      fs.chmodSync(path.join(dir, name), 0o755);
    };
    write('plot-config.sh', `if [ "$2" = Tracker ]; then echo ''; else printf '%s\\n' "$3"; fi\n`);
    write('plot-plan-meta.sh', 'exit 0\n');
    write('plot-host.sh', [
      'case "$1" in',
      `  account) echo '${login}' ;;`,
      '  issue-list)',
      '    case " $* " in',
      '      *" --state closed "*) : ;;',
      `      *) for i in $(seq 1 ${n}); do printf '{"number":%d,"title":"t%d","url":"u","createdAt":"2026-10-01T00:00:00Z","assignees":[]}\\n' "$i" "$i"; done ;;`,
      '    esac ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'));
    return dir;
  };

  it('answers shown 0 and hidden 60 over 60 unassigned rows, while entry.issues keeps the 50-row cap', async () => {
    const dir = fixture(60);
    const entry = freshCacheEntry();
    entry.backend = 'github';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issues).toHaveLength(50);
    expect(entry.waiting).not.toBeNull();
    expect(entry.waiting?.tickets).toHaveLength(0);
    expect(entry.waiting?.shown).toBe(0);
    expect(entry.waiting?.hidden).toBe(60);
    expect(entry.waiting?.complete).toBe(true);
  });

  it('accounts for every row under an unresolved backend, with entry.issues still holding the 50-row cap', async () => {
    const dir = fixture(60);
    const entry = freshCacheEntry();
    entry.backend = '';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    // An unresolved backend matches no host lister, so `ticketSourceOf`
    // answers null and the reader is unmatched — `waitingTickets` falls back
    // to showing every row rather than silently matching GitHub logins.
    expect(entry.issues).toHaveLength(50);
    expect(entry.waiting).not.toBeNull();
    expect(entry.waiting?.tickets).toHaveLength(50);
    expect(entry.waiting?.shown).toBe(60);
    expect(entry.waiting?.hidden).toBe(0);
    expect(entry.waiting?.complete).toBe(true);
  });

  it('sets entry.waiting to null for a nobody source, beside entry.issues', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-waiting-nobody-'));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'plot-config.sh'),
      `#!/usr/bin/env bash\nif [ "$2" = Tracker ]; then printf '%s\\n' 'linear https://linear.app/acme'; else printf '%s\\n' "$3"; fi\n`,
    );
    fs.chmodSync(path.join(dir, 'plot-config.sh'), 0o755);
    const entry = freshCacheEntry();
    entry.backend = 'bitbucket';

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issueAnswer).toBe('unsupported');
    expect(entry.waiting).toBeNull();
  });

  it('sets entry.waiting to null on a failed read, beside entry.issues keeping its last good value', async () => {
    const dir = fixture(1);
    const entry = freshCacheEntry();
    entry.backend = 'github';
    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);
    expect(entry.waiting).not.toBeNull();

    fs.writeFileSync(
      path.join(dir, 'plot-host.sh'),
      '#!/usr/bin/env bash\necho boom >&2\nexit 1\n',
    );
    fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issueAnswer).toBe('failed');
    expect(entry.waiting).toBeNull();
    // `entry.issues` keeps its last good value on the same failure.
    expect(entry.issues).toHaveLength(1);
  });
});

describe('a Draft plan PR answers its issue — the inbox reads idea/ branches as well as the plan directory', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmTree(dir);
  });

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  /**
   * A git repo whose `plot-host.sh` lists issues 1–3 open, whose plan parser
   * reports the numbers on each file's `Issue:` line, and which carries the
   * given plans on `origin/idea/<slug>` refs (not in the working tree).
   */
  const fixture = (opts: {
    onDisk?: Record<string, number>;
    onBranch?: Record<string, number>;
    login?: string;
  }): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-draft-plan-'));
    dirs.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@example.com');
    git(dir, 'config', 'user.name', 't');
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    const write = (name: string, body: string) => {
      fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}`);
      fs.chmodSync(path.join(dir, name), 0o755);
    };
    write('plot-config.sh', `if [ "$2" = Tracker ]; then echo ''; else printf '%s\\n' "$3"; fi\n`);
    write('plot-plan-meta.sh', [
      'for f in "$@"; do',
      '  n=$(sed -n \'s/^Issue: *#\\{0,1\\}\\([0-9]*\\).*/\\1/p\' "$f" | head -1)',
      '  st=$(sed -n \'s/^State: *//p\' "$f" | head -1)',
      '  br=$(sed -n \'s/^Branch: *//p\' "$f" | awk \'{printf "%s{\\"branch\\":\\"%s\\"}", (NR>1?",":""), $1}\')',
      '  if [ -n "$n" ]; then printf \'{"file":"%s","phase":"%s","issues":[%s],"slices":[{"branches":[%s]}]}\\n\' "$f" "${st:-draft}" "$n" "$br"; else echo \'{"issues":[]}\'; fi',
      'done',
      '',
    ].join('\n'));
    write('plot-host.sh', [
      'case "$1" in',
      `  account) echo '${opts.login ?? 'jwloka'}' ;;`,
      '  issue-list)',
      '    case " $* " in',
      '      *" --state closed "*) : ;;',
      '      *) for i in 1 2 3; do printf \'{"number":%d,"title":"t%d","url":"u","createdAt":"2026-10-01T00:00:00Z","assignees":["jwloka"]}\\n\' $i $i; done ;;',
      '    esac ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'));
    for (const [file, n] of Object.entries(opts.onDisk ?? {})) {
      fs.writeFileSync(path.join(dir, 'docs', 'plans', file), `# plan\n\nIssue: #${n}\n`);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    for (const [slug, n] of Object.entries(opts.onBranch ?? {})) {
      git(dir, 'checkout', '-q', '-b', `idea/${slug}`);
      fs.writeFileSync(path.join(dir, 'docs', 'plans', `2026-10-17-${slug}.md`), `# plan\n\nIssue: #${n}\n`);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', slug);
      git(dir, 'update-ref', `refs/remotes/origin/idea/${slug}`, 'HEAD');
      git(dir, 'checkout', '-q', 'main');
      git(dir, 'branch', '-q', '-D', `idea/${slug}`);
    }
    // Checking out main removes a plan directory the branch alone filled.
    fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    return dir;
  };

  /** A cache entry that already knows the idea branches and their open PRs. */
  const entryFor = (slugs: string[], withPr: string[] = slugs) => {
    const entry = freshCacheEntry();
    entry.backend = 'github';
    entry.ideaPlans = new Map(slugs.map((s) => [`idea/${s}`, `2026-10-17-${s}.md`]));
    entry.prs = new Map(withPr.map((s) => [`idea/${s}`, { number: 1, head: `idea/${s}` } as never]));
    return entry;
  };

  const numbers = (rows: readonly { number: string }[]) => rows.map((r) => r.number);

  it('an issue named only by a Draft plan PR leaves the inbox and shows as planning in Waiting on you', async () => {
    const dir = fixture({ onBranch: { alpha: 2 } });
    const entry = entryFor(['alpha']);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.issues)).toEqual(['1', '3']);
    expect(numbers(entry.waiting?.tickets ?? [])).toEqual(['1', '3', '2']);
    expect(entry.waiting?.tickets.find((t) => t.number === '2')?.status).toBe('planning');
  });

  it('the same issue stays out of the inbox once the plan has landed in the directory', async () => {
    const dir = fixture({ onDisk: { '2026-10-17-alpha.md': 2 } });
    const entry = entryFor([]);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.issues)).toEqual(['1', '3']);
    expect(numbers(entry.waiting?.tickets ?? [])).toEqual(['1', '3', '2']);
  });

  it('Waiting on you lists an issue an on-disk plan references after the unplanned ones, with its phase', async () => {
    const dir = fixture({ onDisk: { '2026-10-17-a.md': 1 } });
    const entry = entryFor([]);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.waiting?.tickets ?? [])).toEqual(['2', '3', '1']);
    expect(entry.waiting?.tickets.map((t) => t.status)).toEqual(['', '', 'planning']);
    expect(entry.waiting?.shown).toBe(3);
  });

  it('an unmatched reader still sees only the unplanned set in the inbox, and the planned row after the rest in Waiting', async () => {
    const dir = fixture({ onDisk: { '2026-10-17-a.md': 1 }, login: 'somebody-else' });
    const entry = entryFor([]);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.issues)).toEqual(['2', '3']);
    expect(numbers(entry.waiting?.tickets ?? [])).toEqual(['2', '3', '1']);
  });

  it('an Approved plan shows its merged slice count from the pulse, and none where the pulse lacks the plan', async () => {
    const dir = fixture({});
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'a.md'), '# plan\n\nIssue: #1\nState: approved\nBranch: b/one\nBranch: b/two\nBranch: b/three\n');
    fs.writeFileSync(path.join(dir, 'docs', 'plans', 'b.md'), '# plan\n\nIssue: #2\nState: approved\nBranch: b/four\n');
    const entry = entryFor([]);
    const wave = (states: [string, string][]) => ({ branches: states.map(([branch, state]) => ({ branch, state })) });
    entry.pulse = { plans: [{ file: 'a.md', slices: [wave([['b/one', 'merged'], ['b/two', 'merged'], ['b/three', 'open']])] }] } as never;

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    const status = (n: string) => entry.waiting?.tickets.find((t) => t.number === n)?.status;
    expect(status('1')).toBe('in progress 2/3');
    expect(status('2')).toBe('in progress');
    expect(numbers(entry.issues)).toEqual(['3']);
  });

  it('no idea branches changes nothing from the directory read', async () => {
    const dir = fixture({ onDisk: { '2026-10-17-a.md': 3 } });
    const entry = entryFor([]);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.issues)).toEqual(['1', '2']);
  });

  it('an idea branch without an open PR is not read', async () => {
    const dir = fixture({ onBranch: { alpha: 2 } });
    const entry = entryFor(['alpha'], []);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(numbers(entry.issues)).toEqual(['1', '2', '3']);
  });

  it('one unreadable branch plan does not blank the directory read', async () => {
    const dir = fixture({ onDisk: { '2026-10-17-a.md': 1 }, onBranch: { alpha: 2 } });
    const entry = entryFor(['alpha', 'ghost']);

    await refreshIssues({ repoRoot: dir, scriptsDir: dir }, entry);

    expect(entry.issueAnswer).toBe('answered');
    expect(numbers(entry.issues)).toEqual(['3']);
  });
});
