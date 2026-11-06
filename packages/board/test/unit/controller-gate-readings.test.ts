import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT, controllerGateOf, runGates, type ControllerReadings, type Where } from '../../src/server/entry/gate.js';
import { run as approve } from '../../src/server/entry/approve.js';
import { run as deliver } from '../../src/server/entry/deliver.js';

/**
 * The controller gate against injected readings: which git readings it takes,
 * what a failed reading answers, and that Bitbucket now requires the pin like
 * every other `plot-host.sh pr-merge` backend.
 */

const GATED = ['bash skills/plot/scripts/plot-', 'deliver.sh s'].join('');

/** Readings that count the git reads and answer `where`, or throw it. */
const readings = (where: Where | Error, { desk = false, backend = 'github' } = {}) => {
  const reads = { where: 0, backend: 0 };
  const r: ControllerReadings = {
    desk: () => desk,
    where: async () => {
      reads.where += 1;
      if (where instanceof Error) throw where;
      return where;
    },
    backend: async () => {
      reads.backend += 1;
      return backend;
    },
  };
  return { r, reads };
};

const ask = async (r: ControllerReadings, command: string) => {
  const warned: string[] = [];
  const code = await runGates([controllerGateOf(r)], 'all', command, (l) => warned.push(l));
  return { code, warned: warned.join('\n') };
};

const MAIN: Where = { root: { ok: true, value: '/nowhere/repo' }, linked: false };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the controller gate reads no git before its text tests (LOW 9)', () => {
  it('allows an unattended call that names nothing outside a desk, with no git reading', async () => {
    vi.stubEnv('PLOT_UNATTENDED', '1');
    const { r, reads } = readings(new Error('git is broken'));
    expect(await ask(r, 'ls -la')).toEqual({ code: EXIT.allow, warned: '' });
    expect(reads.where).toBe(0);
  });

  it('allows an unattended call at a desk when the git reading throws', async () => {
    vi.stubEnv('PLOT_UNATTENDED', '1');
    const { r, reads } = readings(new Error('git is broken'), { desk: true });
    expect((await ask(r, 'ls -la')).code).toBe(EXIT.allow);
    expect(reads.where).toBe(1);
  });

  it('allows a call that names a merge word but runs no gated action when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    expect((await ask(r, 'git merge origin/main')).code).toBe(EXIT.allow);
  });

  it('refuses a gated action when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    const answer = await ask(r, GATED);
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('git is broken');
  });

  it('refuses an unpinned merge when the git reading throws', async () => {
    const { r } = readings(new Error('git is broken'));
    expect((await ask(r, 'gh pr merge 12')).code).toBe(EXIT.refuse);
  });
});

describe('the review status has one writer', () => {
  const FORMS = [
    'plot-host.sh commit-status abc123 success plot/review',
    'gh api repos/o/r/statuses/abc123 -f context=plot/review -f state=success',
  ];
  const ALLOWED = ['plot-review.mjs 42', 'plot-host.sh commit-status abc123 success ci/build', 'gh api repos/o/r/statuses/abc123'];
  const wheres: [string, Where | Error][] = [
    ['a desk (linked: true)', { root: { ok: true, value: '/nowhere/repo' }, linked: true }],
    ['the main checkout (linked: false)', MAIN],
    ['a git reading that throws', new Error('git is broken')],
  ];

  describe.each([['unattended', '1'], ['attended', '']])('%s', (_label, unattended) => {
    it.each(FORMS.flatMap((form) => wheres.map(([label, where]) => [form, label, where] as const)))('refuses %s with %s', async (form, _l, where) => {
      vi.stubEnv('PLOT_UNATTENDED', unattended);
      const { r } = readings(where);
      const answer = await ask(r, form);
      expect(answer.code).toBe(EXIT.refuse);
      expect(answer.warned).toContain('plot-review.mjs');
    });

    it.each(ALLOWED)('allows %s', async (command) => {
      vi.stubEnv('PLOT_UNATTENDED', unattended);
      const { r } = readings({ root: { ok: true, value: '/nowhere/repo' }, linked: true });
      expect((await ask(r, command)).code).toBe(EXIT.allow);
    });
  });

  it('reads no git before it refuses', async () => {
    const { r, reads } = readings(MAIN);
    await ask(r, FORMS[1]!);
    expect(reads.where).toBe(0);
  });

  it('allows a commit message that quotes the write', async () => {
    const { r } = readings({ root: { ok: true, value: '/nowhere/repo' }, linked: true });
    expect((await ask(r, 'git commit -m "gh api repos/o/r/statuses/x -f context=plot/review"')).code).toBe(EXIT.allow);
  });
});

describe('an unpinned plot-host.sh pr-merge on Bitbucket (M6)', () => {
  it('refuses on bitbucket too, naming --match-head', async () => {
    const { r } = readings(MAIN, { backend: 'bitbucket' });
    const answer = await ask(r, 'bash skills/plot/scripts/plot-host.sh pr-merge 12');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('add --match-head <sha>');
  });

  it('allows a pinned merge on bitbucket', async () => {
    const { r } = readings(MAIN, { backend: 'bitbucket' });
    const answer = await ask(r, 'bash skills/plot/scripts/plot-host.sh pr-merge 12 --match-head abc');
    expect(answer.code).toBe(EXIT.allow);
  });

  it('refuses on github, naming --match-head', async () => {
    const { r } = readings(MAIN);
    const answer = await ask(r, 'bash skills/plot/scripts/plot-host.sh pr-merge 12');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('add --match-head <sha>');
  });

  it('still refuses gh pr merge on bitbucket, naming --match-head-commit', async () => {
    const { r } = readings(MAIN, { backend: 'bitbucket' });
    const answer = await ask(r, 'gh pr merge 12');
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toContain('add --match-head-commit <sha>');
  });

  it('asks no backend for a pinned merge', async () => {
    const { r, reads } = readings(MAIN);
    expect((await ask(r, 'bash plot-host.sh pr-merge 12 --match-head abc')).code).toBe(EXIT.allow);
    expect(reads.backend).toBe(0);
  });

  it('#2706: a grep naming pr-merge on plot-host.sh is a read, not an unpinned merge', async () => {
    const { r } = readings(MAIN);
    const answer = await ask(r, 'grep -n pr-merge skills/plot/scripts/plot-host.sh');
    expect(answer.code).toBe(EXIT.allow);
  });
});

describe('a desk and no git', () => {
  it('allows a gated action in a linked worktree', async () => {
    const { r } = readings({ root: { ok: true, value: '/nowhere/desk' }, linked: true });
    expect((await ask(r, GATED)).code).toBe(EXIT.allow);
  });

  it('allows a gated action with no git, and says it went UNVERIFIED', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { r } = readings({ root: { ok: false }, linked: false });
      expect((await ask(r, GATED)).code).toBe(EXIT.allow);
      expect(write.mock.calls.join('')).toContain('UNVERIFIED');
    } finally {
      write.mockRestore();
    }
  });
});

describe('release-approve and the HTTP routes refuse with no receipt escape', () => {
  /** A repo root carrying a fresh receipt for `action`, so the ordinary receipt-clearing path would answer `null` if it ran. */
  const withReceipt = (action: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-receipt-'));
    const receiptDir = join(dir, '.plot', 'state', 'action-receipts');
    mkdirSync(receiptDir, { recursive: true });
    writeFileSync(join(receiptDir, action), 'spent\n');
    return dir;
  };

  const CASES = [
    ['release-approve', 'node board/plot-ask.mjs release-approve 1 abc1234'],
    ['release', 'curl -X POST http://localhost:4000/api/release'],
    ['release-approve route', 'curl -X POST http://localhost:4000/api/release-approve'],
    ['restart', 'curl -X POST http://localhost:4000/api/restart'],
    // The same POST written the other ways an agent writes it. Each of these
    // passed the gate while only the bare `-X POST` form was read.
    ['a quoted URL', 'curl -X POST "http://localhost:4000/api/release"'],
    ['a quoted URL and method', "curl -X 'POST' 'http://localhost:4000/api/release-approve'"],
    ['a grouped short option', 'curl -sXPOST http://localhost:4000/api/release'],
    ['a short option group ending at X', 'curl -sX POST http://localhost:4000/api/restart'],
    ['--request=POST', 'curl --request=POST http://localhost:4000/api/release'],
    ['a body-implied POST', 'curl -d \'{"slug":"x","version":"1.2.3"}\' http://localhost:4000/api/release'],
    ['--data-raw', 'curl --data-raw slug=x http://localhost:4000/api/release-approve'],
    ['--json', 'curl --json \'{"slug":"x"}\' http://localhost:4000/api/release'],
    ['a form upload', 'curl -F slug=x http://localhost:4000/api/restart'],
    ['wget --post-data', 'wget --post-data=slug=x http://localhost:4000/api/release'],
    ['wget --method=POST', 'wget --method=POST http://localhost:4000/api/restart'],
    ['wget --method POST', 'wget --method POST http://localhost:4000/api/release-approve'],
    ['httpie with a method', 'http POST :4000/api/release'],
    ['the https binary', 'https POST localhost:4000/api/release-approve'],
    ['httpie body items', 'http :4000/api/release slug=x version=1.2.3'],
  ] as const;

  it.each(CASES)('refuses %s from the main checkout with a fresh receipt present, naming the board button', async (_label, command) => {
    const dir = withReceipt('release-approve');
    try {
      const { r } = readings({ root: { ok: true, value: dir }, linked: false });
      const answer = await ask(r, command);
      expect(answer.code).toBe(EXIT.refuse);
      expect(answer.warned).toMatch(/board/i);
      expect(answer.warned).not.toContain('plot-state-receipt.sh');
      expect(answer.warned).not.toContain('unowned-action');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(CASES)('refuses %s from a linked worktree (a desk)', async (_label, command) => {
    const dir = withReceipt('release-approve');
    try {
      const { r } = readings({ root: { ok: true, value: dir }, linked: true });
      const answer = await ask(r, command);
      expect(answer.code).toBe(EXIT.refuse);
      expect(answer.warned).toMatch(/board/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(CASES)('refuses %s even when the git reading throws', async (_label, command) => {
    const { r } = readings(new Error('git is broken'));
    const answer = await ask(r, command);
    expect(answer.code).toBe(EXIT.refuse);
    expect(answer.warned).toMatch(/board/i);
  });

  it('still allows the master agent route for release under the existing receipt', async () => {
    const dir = withReceipt('release');
    try {
      const { r } = readings({ root: { ok: true, value: dir }, linked: false });
      const answer = await ask(r, 'node board/plot-deliver.mjs --release my-plan 1.2.3');
      expect(answer.code).toBe(EXIT.allow);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still allows the master agent route for restart under the existing receipt', async () => {
    const dir = withReceipt('restart');
    try {
      const { r } = readings({ root: { ok: true, value: dir }, linked: false });
      const answer = await ask(r, 'node board/plot-restart-command.mjs feature/some-branch');
      expect(answer.code).toBe(EXIT.allow);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['a grep for the subcommand', 'grep release-approve docs/plans/2026-11-03-who-may-approve-a-release-and.md'],
    ['a cat of a file naming it', 'cat notes/release-approve.md'],
    ['a comment naming plot-ask.mjs release-approve', '# plot-ask.mjs release-approve runs the merge'],
  ])('still allows %s as a read', async (_label, command) => {
    const { r } = readings(MAIN);
    expect((await ask(r, command)).code).toBe(EXIT.allow);
  });

  it.each([
    ['GET on the release route', 'curl http://localhost:4000/api/release'],
    ['explicit GET on restart', 'curl -X GET http://localhost:4000/api/restart'],
    ['POST to a different route', 'curl -X POST http://localhost:4000/api/dispatch'],
    // A quoted GET, and the per-plan poll `skills/plot-release/SKILL.md:487`
    // tells the agent to run while a release finishes.
    ['a quoted GET', 'curl "http://localhost:4000/api/release"'],
    ['the release poll', 'curl -s http://localhost:4000/api/release/my-slug'],
    ['a quoted release poll', 'curl "http://localhost:4000/api/release/my-slug"'],
    ['httpie polling the release', 'http GET :4000/api/release/my-slug'],
    // An explicit method wins over one a body flag implies, as it does in curl.
    ['a body flag an explicit GET overrides', 'curl -d slug=x -X GET http://localhost:4000/api/release'],
    ['wget with an explicit GET', 'wget --method=GET http://localhost:4000/api/release'],
    // httpie items that send no body: a header and a query parameter.
    ['httpie sending only a header', 'http :4000/api/release X-Token:abc'],
    ['httpie sending only a query parameter', 'http :4000/api/release q==1'],
    ['a route the name only prefixes', 'curl -X POST http://localhost:4000/api/release2'],
  ])("keeps today's allow answer for %s", async (_label, command) => {
    const { r } = readings(MAIN);
    expect((await ask(r, command)).code).toBe(EXIT.allow);
  });
});

describe('--who takes a name (H2, #1449)', () => {
  it.each([
    ['approve', approve, 'plot-approve'],
    ['deliver', deliver, 'plot-deliver'],
  ])('%s refuses a --who value that starts with -', async (_name, entry, prefix) => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-who-'));
    try {
      const warned: string[] = [];
      const code = await entry(['--who', '--dry-run', 'slug'], dir, dir, () => undefined, (s) => warned.push(s));
      expect(code).toBe(1);
      expect(warned.join('')).toBe(`${prefix}: --who takes a name, not the flag '--dry-run'\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
