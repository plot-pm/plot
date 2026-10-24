import { describe, expect, it } from 'vitest';
import {
  controllerRefusal,
  mayRunController,
  pinUnavailable,
  UNPINNABLE_NOTE,
  unpinnedMerges,
  unpinnedMergeRefusal,
  withoutMessageSinks,
  withoutQuotedHeredocs,
} from '../src/rules/controller-gate.js';
import { controllerInvocation } from '../src/rules/ci-suite.js';

describe('withoutQuotedHeredocs', () => {
  it('drops the body of a single-quoted heredoc and keeps the opener and terminator', () => {
    const command = "cat <<'EOF'\nplot-deliver.sh x\nEOF\nls";
    expect(withoutQuotedHeredocs(command)).toBe("cat <<'EOF'\nEOF\nls");
  });

  it('accepts <<- with a tab-indented terminator', () => {
    expect(withoutQuotedHeredocs("cat <<-'END'\n\tbody\n\tEND\nls")).toBe("cat <<-'END'\n\tEND\nls");
  });

  it('keeps an unquoted or double-quoted body', () => {
    const unquoted = 'cat <<EOF\nplot-deliver.sh x\nEOF';
    expect(withoutQuotedHeredocs(unquoted)).toBe(unquoted);
    const double = 'cat <<"EOF"\nplot-deliver.sh x\nEOF';
    expect(withoutQuotedHeredocs(double)).toBe(double);
  });
});

describe('withoutMessageSinks', () => {
  // Issue #2440: the gate refused a commit message that only names a gated
  // script, never runs one — `controllerInvocation` reads this output, so
  // these pin the reading through that function, the same as the heredoc strip above.
  it('blanks a git commit -m value naming a gated script', () => {
    const command = 'git commit -m "plot-deliver.sh flipped only the Status block"';
    expect(controllerInvocation(withoutMessageSinks(command))).toBeNull();
  });

  it('blanks a git commit --message value naming a gated script', () => {
    const command = 'git commit --message "plot-deliver.sh flipped only the Status block"';
    expect(controllerInvocation(withoutMessageSinks(command))).toBeNull();
  });

  it('blanks an unquoted git commit -F - heredoc body naming a gated script', () => {
    const command = ['git commit -F - <<EOF', 'plot-deliver.sh flipped only the Status block', 'EOF'].join('\n');
    expect(controllerInvocation(withoutMessageSinks(withoutQuotedHeredocs(command)))).toBeNull();
  });

  it('blanks the reason argument of plot-state-receipt.sh --unowned-action', () => {
    const command = 'plot-state-receipt.sh --unowned-action deliver some-slug "plot-deliver.sh flipped only the Status block"';
    expect(controllerInvocation(withoutMessageSinks(command))).toBeNull();
  });

  it('never blanks a heredoc body holding a $( ) substitution — it can still invoke a gated script', () => {
    const command = ['git commit -F - <<EOF', 'written by $(plot-deliver.sh --note)', 'EOF'].join('\n');
    expect(controllerInvocation(withoutMessageSinks(withoutQuotedHeredocs(command)))).toBe('deliver');
  });

  it('never blanks a heredoc body holding a backtick substitution', () => {
    const body = 'written by `plot-deliver.sh --note`';
    const command = ['git commit -F - <<EOF', body, 'EOF'].join('\n');
    expect(withoutMessageSinks(withoutQuotedHeredocs(command))).toContain(body);
  });

  it('does not touch a heredoc feeding a command other than git commit -F -', () => {
    const command = ['cat <<EOF', 'plot-deliver.sh x', 'EOF'].join('\n');
    expect(withoutMessageSinks(command)).toBe(command);
  });

  it('does not blank a quoted -m value with no gated script, leaving the rest of the command readable', () => {
    const command = 'git commit -m "unrelated text" && bash plot-dispatch.sh slug';
    expect(controllerInvocation(withoutMessageSinks(command))).toBe('dispatch');
  });

  it('a real invocation beside a stripped commit message still refuses', () => {
    const command = ['plot-dispatch.sh slug && git commit -F - <<EOF', 'and we recorded it', 'EOF'].join('\n');
    expect(controllerInvocation(withoutMessageSinks(withoutQuotedHeredocs(command)))).toBe('dispatch');
  });
});

describe('mayRunController', () => {
  it.each(['bash plot-deliver.sh x', 'node board/plot-approve.mjs x', 'bash *.sh', 'node b/plot-appro?e.mjs', 'gh pr merge 1', 'plot-host.sh pr-merge 1'])(
    'passes %s',
    (command) => expect(mayRunController(command)).toBe(true),
  );

  it.each(['ls -la', 'git commit -m x', 'pnpm test'])('skips %s', (command) => expect(mayRunController(command)).toBe(false));
});

describe('unpinnedMerges', () => {
  it.each([
    ['gh pr merge 12 --squash', ['gh']],
    ['gh pr merge 12', ['gh']],
    ['gh -R o/r pr merge 12', ['gh']],
    ['bash skills/plot/scripts/plot-host.sh pr-merge 12', ['plot-host']],
    ['cd x && gh pr merge 12 --squash --delete-branch', ['gh']],
    ['gh pr merge 12 --squash # --match-head-commit abc', ['gh']],
    ['command gh pr merge 12', ['gh']],
    ['builtin exec gh pr merge 12', ['gh']],
    ['gh pr merge 12 --match-head abc123', ['gh']],
    ['bash plot-host.sh pr-merge 12 --match-head-commit abc', ['plot-host']],
    ['gh pr merge 1; bash plot-host.sh pr-merge 2', ['gh', 'plot-host']],
  ])('refuses %s', (command, programs) => expect(unpinnedMerges(command)).toEqual(programs));

  it.each([
    'gh pr merge 12 --squash --match-head-commit abc123',
    'gh pr merge 12 --match-head-commit=abc123',
    'bash plot-host.sh pr-merge 12 --match-head abc',
    'command gh pr merge 12 --match-head-commit abc',
    'gh pr view 12',
    'gh pr list --search merge',
    'git commit -m "gh pr merge 12"',
    'git grep -l "gh pr merge"',
    'ls gh pr merge',
    'FOO=1',
    'command',
    'echo ok # gh pr merge 12',
  ])('allows %s', (command) => expect(unpinnedMerges(command)).toEqual([]));

  it('leaves controllerInvocation null for a merge', () => {
    expect(controllerInvocation('gh pr merge 123 --squash')).toBeNull();
  });
});

describe('pinUnavailable', () => {
  it('lets an unpinned plot-host.sh pr-merge through only where the host cannot pin', () => {
    expect(pinUnavailable('plot-host', false)).toBe(true);
    expect(pinUnavailable('plot-host', true)).toBe(false);
    expect(pinUnavailable('gh', false)).toBe(false);
  });

  it('says nothing pins there', () => {
    expect(UNPINNABLE_NOTE).toContain('cannot pin a merge');
  });
});

describe('the refusal texts', () => {
  const dir = '/plugins/plot/skills/plot/scripts';

  it('names the endpoint first for approve, deliver and release, and no bundle', () => {
    expect(controllerRefusal('approve', dir)).toContain('POST /api/approve {"slug":"<slug>"}');
    expect(controllerRefusal('deliver', dir)).toContain('POST /api/deliver {"slug":"<slug>"}');
    expect(controllerRefusal('release', dir)).toContain('POST /api/release {"slug":"<slug>","version":"<version>"}');
    for (const action of ['approve', 'deliver', 'release'] as const) {
      expect(controllerRefusal(action, dir)).not.toContain('.mjs');
    }
  });

  it('names the bundle for dispatch only', () => {
    expect(controllerRefusal('dispatch', dir)).toContain(`node ${dir}/board/plot-dispatch-command.mjs <slug>`);
  });

  it('names the two-call order and the receipt command', () => {
    const text = controllerRefusal('approve', dir);
    expect(text).toContain(`1. bash ${dir}/plot-state-receipt.sh --unowned-action approve <slug> "<reason>"`);
    expect(text).toContain('TWO calls');
  });

  it('quotes a path with a space as one word', () => {
    expect(controllerRefusal('approve', '/a b/scripts')).toContain("bash '/a b/scripts/plot-state-receipt.sh'");
  });

  it('names plot-ask.mjs merge for an unpinned merge', () => {
    expect(unpinnedMergeRefusal(dir, 'gh')).toContain(`node ${dir}/board/plot-ask.mjs merge <pr> <sha>`);
  });

  it('names the pin flag of the program refused', () => {
    expect(unpinnedMergeRefusal(dir, 'gh')).toContain('add --match-head-commit <sha>');
    expect(unpinnedMergeRefusal(dir, 'plot-host')).toContain('add --match-head <sha>');
  });

  it('names why gh has no path on a host it cannot reach, without naming the host', () => {
    const text = unpinnedMergeRefusal(dir, 'gh');
    expect(text).toContain('gh speaks to one git host');
    expect(text.toLowerCase()).not.toContain('bitbucket');
  });

  it('names no other-host reach for plot-host, which already reaches every configured host', () => {
    expect(unpinnedMergeRefusal(dir, 'plot-host')).not.toContain('speaks to one git host');
  });
});
