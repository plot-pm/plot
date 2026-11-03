import { describe, expect, it } from 'vitest';
import {
  controllerRefusal,
  finalControllerRefusal,
  mayRunController,
  mergeCalls,
  unpinnedMerges,
  unpinnedMergeRefusal,
  withoutMessageSinks,
  withoutQuotedHeredocs,
} from '../src/rules/controller-gate.js';
import { controllerHttpAction, controllerInvocation } from '../src/rules/ci-suite.js';

describe('withoutQuotedHeredocs', () => {
  it('blanks the body of a single-quoted heredoc and keeps the opener, the terminator and every line', () => {
    const command = "cat <<'EOF'\nplot-deliver.sh x\nEOF\nls";
    expect(withoutQuotedHeredocs(command)).toBe(`cat <<'EOF'\n${' '.repeat(17)}\nEOF\nls`);
  });

  it('accepts <<- with a tab-indented terminator', () => {
    expect(withoutQuotedHeredocs("cat <<-'END'\n\tbody\n\tEND\nls")).toBe("cat <<-'END'\n     \n\tEND\nls");
  });

  it('blanks the body of a heredoc inside a quoted $( ) substitution', () => {
    const command = ['git commit -m "$(cat <<\'EOF\'', 'plot-deliver.sh flipped it', 'EOF', ')"'].join('\n');
    const stripped = withoutQuotedHeredocs(command);
    expect(stripped.split('\n')[1].trim()).toBe('');
    expect(controllerInvocation(stripped)).toBeNull();
  });

  // Outside #2518's diff, found in its review (#2544): the old line reader
  // took `<< 'x'` out of `<<< 'x'` and dropped every later line.
  it('reads a here-string as no heredoc and drops no later line', () => {
    const command = "git log <<< 'x'\nbash skills/plot/scripts/plot-deliver.sh slug";
    expect(withoutQuotedHeredocs(command)).toBe(command);
    expect(controllerInvocation(withoutQuotedHeredocs(command))).toBe('deliver');
  });

  it('reads a << inside quotes as no heredoc', () => {
    const command = ['echo "<<\'X\'"', 'plot-deliver.sh slug', 'X'].join('\n');
    expect(withoutQuotedHeredocs(command)).toBe(command);
  });

  it('returns an unterminated heredoc unchanged', () => {
    const command = "cat <<'EOF'\nplot-deliver.sh slug";
    expect(withoutQuotedHeredocs(command)).toBe(command);
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

  it('still reads a gated script that follows a blanked -m value on the same line', () => {
    const command = 'git commit -m "unrelated text" && bash plot-dispatch.sh slug';
    expect(controllerInvocation(withoutMessageSinks(command))).toBe('dispatch');
  });

  it('a real invocation beside a stripped commit message still refuses', () => {
    const command = ['plot-dispatch.sh slug && git commit -F - <<EOF', 'and we recorded it', 'EOF'].join('\n');
    expect(controllerInvocation(withoutMessageSinks(withoutQuotedHeredocs(command)))).toBe('dispatch');
  });

  it('does not treat git push as git commit', () => {
    const command = 'git push origin plot-deliver.sh-notes';
    expect(withoutMessageSinks(command)).toBe(command);
  });

  it('leaves an empty segment from a doubled delimiter untouched', () => {
    const command = 'git commit -m "plot-deliver.sh flipped only the Status block" && && ls';
    expect(controllerInvocation(withoutMessageSinks(command))).toBeNull();
  });
});

describe('withoutMessageSinks never blanks what the shell runs (#2544)', () => {
  const D = 'skills/plot/scripts/plot-deliver.sh';
  const read = (command: string): string => withoutMessageSinks(withoutQuotedHeredocs(command));

  // HIGH 1: a substitution in a -m/--message value or a receipt reason runs before git does.
  it.each([
    ['a $( ) in -m', `git commit -m "$(bash ${D} slug)"`],
    ['a backtick in -m', `git commit -m "\`bash ${D} slug\`"`],
    ['a bare $( ) in -m', `git commit -m $(bash ${D} slug)`],
    ['a $( ) in --message=', `git commit --message="$(bash ${D} slug)"`],
    ['a $( ) after -am', `git commit -am "$(bash ${D} slug)"`],
    ['a backslash-newline that joins $( ) in -m', `git commit -m "$\\\n(bash ${D} slug)"`],
    ['a $( ) in a receipt reason', `plot-state-receipt.sh --unowned-action deliver s "$(${D} x)"`],
    // HIGH 2: the heredoc belongs to sh or bash, not to git commit -F -.
    ['a heredoc fed to sh piped into git commit -F -', ['sh <<EOF | git commit -F -', `bash ${D} slug`, 'EOF'].join('\n')],
    ['a heredoc fed to bash beside git commit -F -', ['bash <<A && git commit -F - <<B', `bash ${D} slug`, 'A', 'msg', 'B'].join('\n')],
    // HIGH 3: a false or unterminated tag hides no later line.
    ['a here-string on git commit -F -', ['git commit -F - <<< "x"', `bash ${D} slug`].join('\n')],
    ['a << inside quotes', ['echo "<<EOF" | git commit -F -', `bash ${D} slug`].join('\n')],
    ['an unterminated heredoc', ['git commit -F - <<EOF', `bash ${D} slug`].join('\n')],
    // MEDIUM 1: the receipt script is an argument here, not the program.
    ['the receipt name as an argument of bash -c', `bash -c '"\${@:4}"' plot-state-receipt.sh --unowned-action a b bash ${D} slug`],
    ['the receipt name as an argument of echo', `echo plot-state-receipt.sh --unowned-action a b; bash ${D} slug`],
  ])('keeps %s readable as a run', (_label, command) => {
    expect(controllerInvocation(read(command))).toBe('deliver');
  });

  it('keeps an unpinned merge inside a quoted -m substitution readable', () => {
    expect(unpinnedMerges(read('git commit -m "$(gh pr merge 12)"'))).toEqual(['gh']);
  });

  it('keeps every line, and every new line in place', () => {
    const command = ['git commit -m "title', '', 'plot-deliver.sh flipped it"', 'git commit -F - <<EOF', 'plot-deliver.sh', 'EOF', 'ls'].join('\n');
    const stripped = read(command);
    expect(stripped.length).toBe(command.length);
    expect([...stripped].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0)).toEqual(
      [...command].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0),
    );
    expect(controllerInvocation(stripped)).toBeNull();
  });
});

describe('withoutMessageSinks reads the commit forms agents use (#2440)', () => {
  it.each([
    ['a ; inside the quoted -m value', 'git commit -m "plot-deliver.sh: fix; retry"'],
    ['a multi-line -m value', ['git commit -m "plot: record', '', 'plot-deliver.sh flipped the field"'].join('\n')],
    ['-am', 'git commit -am "plot-deliver.sh flipped the field"'],
    ['-m with the value attached', 'git commit -m"plot-deliver.sh flipped the field"'],
    ['git -C <dir> commit', 'git -C /tmp/x commit -m "plot-deliver.sh flipped the field"'],
    ['a single-quoted -m value holding backticks', "git commit -m 'use `plot-deliver.sh` there'"],
    ['a $VAR in the -m value', 'git commit -m "plot-deliver.sh flipped $FIELD"'],
    ['a double-quoted heredoc delimiter', ['git commit -F - <<"EOF"', 'plot-deliver.sh flipped it', 'EOF'].join('\n')],
    ['-F - after other flags', ['git commit -s -F - <<EOF', 'plot-deliver.sh flipped it', 'EOF'].join('\n')],
    ['the receipt run by bash', 'bash skills/plot/scripts/plot-state-receipt.sh --unowned-action deliver s plot-deliver.sh flipped'],
    ['the quoted $(cat <<\'EOF\') commit form', ['git commit -m "$(cat <<\'EOF\'', 'plot-deliver.sh flipped it', 'EOF', ')"'].join('\n')],
  ])('blanks %s', (_label, command) => {
    expect(controllerInvocation(withoutMessageSinks(withoutQuotedHeredocs(command)))).toBeNull();
  });

  it.each([
    ['a program before git that it does not know', 'command git commit -m "plot-deliver.sh flipped"'],
    ['a git option it does not know', 'git --exec-path=/x commit -m "plot-deliver.sh flipped"'],
    ['a case statement on the line', 'case x in a) git commit -m "plot-deliver.sh flipped";; esac'],
  ])('leaves %s unchanged', (_label, command) => {
    expect(withoutMessageSinks(command)).toBe(command);
  });
});

describe('withoutMessageSinks reads each git commit option form', () => {
  const heredoc = (opener: string): string => [opener, 'plot-deliver.sh flipped it', 'EOF'].join('\n');

  it.each([
    ['an unquoted --message= value', 'git commit --message=plot-deliver.sh'],
    ['a --message= value quoted as a whole word', 'git commit "--message=plot-deliver.sh flipped"'],
    ['a flag-only global option before commit', 'git --no-pager commit -m "plot-deliver.sh flipped"'],
    ['--file=- with a heredoc', heredoc('git commit --file=- <<EOF')],
    ['-F - closing a cluster', heredoc('git commit -aF - <<EOF')],
    ['-F- closing a cluster', heredoc('git commit -aF- <<EOF')],
    ['a -m after a path, an unknown short option and -C in both forms', 'git commit --amend -uno -CHEAD -C HEAD file.txt -m "plot-deliver.sh flipped"'],
  ])('blanks %s', (_label, command) => {
    expect(controllerInvocation(withoutMessageSinks(command))).toBeNull();
  });

  it.each([
    ['a word before commit with an unknown value', 'git $SUB commit -m "plot-deliver.sh flipped"'],
    ['git with global options and no subcommand', 'git --no-pager -C plot-deliver.sh'],
    ['a -m after --', 'git commit -- -m plot-deliver.sh'],
    ['a --message= value joined by a backslash-newline', 'git commit --message=plot-deliver.sh\\\nx'],
    ['a heredoc beside -F <file>', heredoc('git commit -F msg.txt <<EOF')],
    ['a heredoc beside -F <file> closing a cluster', heredoc('git commit -aF msg.txt <<EOF')],
  ])('leaves %s unchanged', (_label, command) => {
    expect(withoutMessageSinks(command)).toBe(command);
  });
});

describe('mayRunController', () => {
  it.each([
    'bash plot-deliver.sh x',
    'node board/plot-approve.mjs x',
    'bash *.sh',
    'node b/plot-appro?e.mjs',
    'gh pr merge 1',
    'plot-host.sh pr-merge 1',
    'node board/plot-ask.mjs release-approve 1 abc1234',
    'curl -X POST http://localhost:4000/api/release',
    'curl -X POST http://localhost:4000/api/release-approve',
    'curl -X POST http://localhost:4000/api/restart',
  ])('passes %s', (command) => expect(mayRunController(command)).toBe(true));

  it.each(['ls -la', 'git commit -m x', 'pnpm test', 'curl http://localhost:4000/api/dispatch'])('skips %s', (command) =>
    expect(mayRunController(command)).toBe(false),
  );
});

describe('controllerInvocation reads plot-ask.mjs and the gated HTTP routes', () => {
  it('answers release-approve for plot-ask.mjs release-approve', () => {
    expect(controllerInvocation('node skills/plot/scripts/board/plot-ask.mjs release-approve 1 abc1234')).toBe('release-approve');
  });

  it('answers null for a different plot-ask.mjs subcommand', () => {
    expect(controllerInvocation('node skills/plot/scripts/board/plot-ask.mjs merge 1 abc1234')).toBeNull();
  });

  it.each([
    ['release', 'curl -X POST http://localhost:4000/api/release'],
    ['release-approve', 'curl -X POST http://localhost:4000/api/release-approve'],
    ['restart', 'curl -X POST http://localhost:4000/api/restart'],
  ])('answers %s for a POST to its route', (action, command) => expect(controllerInvocation(command)).toBe(action));

  it('answers restart for --request POST', () => {
    expect(controllerInvocation('curl --request POST http://localhost:4000/api/restart')).toBe('restart');
  });

  it.each([
    // A quoted URL or method: the quote must not hide the route or the method.
    ['a quoted URL', 'release', 'curl -X POST "http://localhost:4000/api/release"'],
    ['a single-quoted URL', 'release-approve', "curl -X POST 'http://localhost:4000/api/release-approve'"],
    ['a quoted method', 'release', "curl -X 'POST' http://localhost:4000/api/release"],
    ['a quoted --request value', 'restart', 'curl --request="POST" http://localhost:4000/api/restart'],
    // A short option group: `-X` may be glued to its value or end the group.
    ['a grouped short option', 'release', 'curl -sXPOST http://localhost:4000/api/release'],
    ['a group ending at X', 'restart', 'curl -sX POST http://localhost:4000/api/restart'],
    ['--request=POST', 'release', 'curl --request=POST http://localhost:4000/api/release'],
    // A body flag makes curl POST with no method named at all.
    ['-d', 'release', 'curl -d \'{"slug":"x","version":"1.2.3"}\' http://localhost:4000/api/release'],
    ['a glued -d value', 'release', 'curl -d@body.json http://localhost:4000/api/release'],
    ['--data', 'release', 'curl --data slug=x http://localhost:4000/api/release'],
    ['--data-raw', 'release-approve', 'curl --data-raw slug=x http://localhost:4000/api/release-approve'],
    ['--data-binary', 'restart', 'curl --data-binary @b.json http://localhost:4000/api/restart'],
    ['--data-urlencode', 'release', 'curl --data-urlencode slug=x http://localhost:4000/api/release'],
    ['--json', 'release', 'curl --json \'{"slug":"x"}\' http://localhost:4000/api/release'],
    ['-F', 'restart', 'curl -F slug=x http://localhost:4000/api/restart'],
    ['--form', 'release', 'curl --form slug=x http://localhost:4000/api/release'],
    // wget names its method with --method and implies a POST from a body flag.
    ['wget --post-data', 'release', 'wget --post-data=slug=x http://localhost:4000/api/release'],
    ['wget --post-file', 'release', 'wget --post-file=b.json http://localhost:4000/api/release'],
    ['wget --body-data', 'restart', 'wget --body-data=slug=x http://localhost:4000/api/restart'],
    ['wget --method=POST', 'restart', 'wget --method=POST http://localhost:4000/api/restart'],
    ['wget --method POST', 'release-approve', 'wget --method POST http://localhost:4000/api/release-approve'],
    // httpie takes a method as its first operand, and POSTs on a body item.
    ['httpie with a method', 'release', 'http POST :4000/api/release'],
    ['the https binary', 'release-approve', 'https POST localhost:4000/api/release-approve'],
    ['the httpie binary', 'restart', 'httpie POST :4000/api/restart'],
    ['httpie body items', 'release', 'http :4000/api/release slug=x version=1.2.3'],
    ['an httpie raw-JSON item', 'release', 'http :4000/api/release count:=1'],
    ['an httpie file item', 'release', 'http :4000/api/release body@b.json'],
  ])('answers %s for %s written as %s', (_label, action, command) => {
    expect(controllerInvocation(command)).toBe(action);
    expect(controllerHttpAction(command)).toBe(action);
    expect(mayRunController(command)).toBe(true);
  });

  it.each([
    ['no method (GET by default)', 'curl http://localhost:4000/api/release'],
    ['an explicit GET', 'curl -X GET http://localhost:4000/api/release'],
    ['a POST to a different route', 'curl -X POST http://localhost:4000/api/dispatch'],
    ['a quoted GET', 'curl "http://localhost:4000/api/release"'],
    // `skills/plot-release/SKILL.md:487` polls this route while a release runs.
    ['the per-plan release poll', 'curl -s http://localhost:4000/api/release/my-slug'],
    ['a quoted release poll', 'curl "http://localhost:4000/api/release/my-slug"'],
    ['httpie polling the release', 'http GET :4000/api/release/my-slug'],
    // An explicit method wins over one a body flag implies, as curl does.
    ['a body flag an explicit GET overrides', 'curl -d slug=x -X GET http://localhost:4000/api/release'],
    ['wget with an explicit GET', 'wget --method=GET --post-data=slug=x http://localhost:4000/api/release'],
    ['httpie with an explicit GET and a body item', 'http GET :4000/api/release slug=x'],
    // httpie items that send no body.
    ['an httpie header', 'http :4000/api/release X-Token:abc'],
    ['an httpie query parameter', 'http :4000/api/release q==1'],
    ['a bare httpie URL', 'http :4000/api/release'],
    ['a route the name only prefixes', 'curl -X POST http://localhost:4000/api/release2'],
    ['a POST by a program that makes no request', 'node tools/post.mjs -X POST http://localhost:4000/api/release'],
  ])("keeps today's null answer for %s", (_label, command) => {
    expect(controllerInvocation(command)).toBeNull();
    expect(controllerHttpAction(command)).toBeNull();
  });

  it.each([
    ['a grep for the subcommand', 'grep release-approve docs/plans/2026-11-03-who-may-approve-a-release-and.md'],
    ['a cat of a file naming it', 'cat notes/release-approve.md'],
    ['a comment naming plot-ask.mjs release-approve', '# plot-ask.mjs release-approve runs the merge'],
    [
      'a single-quoted heredoc body naming the route',
      withoutQuotedHeredocs(["cat <<'EOF'", 'curl -X POST http://localhost:4000/api/release', 'EOF'].join('\n')),
    ],
  ])('leaves %s as a read', (_label, command) => expect(controllerInvocation(withoutMessageSinks(command))).toBeNull());
});

describe('controllerHttpAction', () => {
  it.each([
    ['release', 'curl -X POST http://localhost:4000/api/release'],
    ['release-approve', 'curl -X POST http://localhost:4000/api/release-approve'],
    ['restart', 'curl -X POST http://localhost:4000/api/restart'],
  ])('answers %s for a POST to its route', (action, command) => expect(controllerHttpAction(command)).toBe(action));

  it('answers null for the plot-ask.mjs script call, which is not an HTTP request', () => {
    expect(controllerHttpAction('node skills/plot/scripts/board/plot-ask.mjs release-approve 1 abc1234')).toBeNull();
  });

  it('answers null for a GET', () => {
    expect(controllerHttpAction('curl http://localhost:4000/api/release')).toBeNull();
  });
});

describe('finalControllerRefusal', () => {
  const dir = '/plugins/plot/skills/plot/scripts';

  it('names the board button and plot-ask.mjs for release-approve, and offers no receipt bypass', () => {
    const text = finalControllerRefusal('release-approve', dir);
    expect(text).toContain(`node ${dir}/board/plot-ask.mjs release-approve <pr> <sha>`);
    expect(text).toContain("board's Approve release button");
    expect(text).not.toContain('plot-state-receipt.sh');
    expect(text).not.toContain('unowned-action');
  });

  it('names the board button and the deliver bundle for release, with no receipt bypass', () => {
    const text = finalControllerRefusal('release', dir);
    expect(text).toContain('POST /api/release');
    expect(text).toContain(`node ${dir}/board/plot-deliver.mjs --release`);
    expect(text).not.toContain('plot-state-receipt.sh');
  });

  it('names the board button and the restart bundle for restart, with no receipt bypass', () => {
    const text = finalControllerRefusal('restart', dir);
    expect(text).toContain('POST /api/restart');
    expect(text).toContain(`node ${dir}/board/plot-restart-command.mjs <branch>`);
    expect(text).not.toContain('plot-state-receipt.sh');
  });
});

describe('mergeCalls', () => {
  it.each([
    ['gh pr merge 42', ['gh']],
    ['gh pr merge 42 --match-head-commit deadbeef', ['gh']],
    ['plot-host.sh pr-merge 42 --match-head deadbeef', ['plot-host']],
    ['command gh pr merge 42 && skills/plot/scripts/plot-host.sh pr-merge 7', ['gh', 'plot-host']],
    ['git commit -m "$(gh pr merge 12 --match-head-commit abc)"', ['gh']],
  ])('reads %s, pinned or not', (command, programs) => expect(mergeCalls(command)).toEqual(programs));

  it.each(['gh pr view 42 && git merge origin/main', 'echo "gh pr merge 42"', 'grep pr-merge plot-host.sh'])('reads no merge in %s', (command) =>
    expect(mergeCalls(command)).toEqual([]),
  );
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
    'case x in a) b;; esac',
  ])('allows %s', (command) => expect(unpinnedMerges(command)).toEqual([]));

  it('leaves controllerInvocation null for a merge', () => {
    expect(controllerInvocation('gh pr merge 123 --squash')).toBeNull();
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

  it('names the bundle for dispatch and restart, and the branch for restart', () => {
    expect(controllerRefusal('dispatch', dir)).toContain(`node ${dir}/board/plot-dispatch-command.mjs <slug>`);
    expect(controllerRefusal('restart', dir)).toContain(`node ${dir}/board/plot-restart-command.mjs <branch>`);
  });

  it('names plot-ask.mjs for release-approve, which has no script and no route', () => {
    const text = controllerRefusal('release-approve', dir);
    expect(text).toContain(`node ${dir}/board/plot-ask.mjs release-approve <pr> <sha>`);
    expect(text).toContain('plot-controller-gate: plot-ask.mjs release-approve is a controller-owned action.');
    expect(text).not.toContain('plot-release-approve.sh');
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
