import { describe, expect, it } from 'vitest';
import { blankSpans, readShell } from '../src/rules/shell-reading.js';

const values = (command: string): (string | null)[][] =>
  (readShell(command)?.commands ?? []).map((simple) => simple.words.map((word) => word.value));

describe('readShell', () => {
  it('splits simple commands on operators outside quotes only', () => {
    expect(values('a "b; c" && d | e || f; g & h')).toEqual([['a', 'b; c'], ['d'], ['e'], ['f'], ['g'], ['h']]);
  });

  it('removes quotes and backslashes from a word value', () => {
    expect(values(`x 'a b'"c d"\\ e`)).toEqual([['x', 'a bc d e']]);
  });

  it('gives an expanding word no value and marks only a running one as executing', () => {
    const words = readShell('x "$HOME" "$(y)" `z` ${w} $\'q\'')?.commands.at(-1)?.words ?? [];
    expect(words.map((word) => [word.value, word.executes])).toEqual([
      ['x', false],
      [null, false],
      [null, true],
      [null, true],
      [null, true],
      [null, true],
    ]);
  });

  it('reads the commands inside $( ) and <( )', () => {
    expect(values('a "$(b c)" <(d)')).toEqual([['b', 'c'], ['d'], ['a', null, null]]);
  });

  it('gives each heredoc to the command whose redirection opens it, in body order', () => {
    const command = ['sh <<A | git commit -F - <<-\'B\'', 'one', 'A', 'two', '\tB', 'tail'].join('\n');
    const reading = readShell(command);
    const [sh, git] = reading?.commands ?? [];
    expect(sh.heredocs.map((doc) => command.slice(doc.bodyStart, doc.bodyEnd))).toEqual(['one\n']);
    expect(git.heredocs.map((doc) => [command.slice(doc.bodyStart, doc.bodyEnd), doc.quoted, doc.singleQuoted])).toEqual([['two\n', true, true]]);
    expect(reading?.commands.at(-1)?.words.map((word) => word.value)).toEqual(['tail']);
  });

  it('reads a here-string, a << in quotes, a redirection and an IO number as no heredoc', () => {
    const reading = readShell('a <<< "x" "<<y" 2>&1 >out <in');
    expect(reading?.heredocs).toEqual([]);
    expect(reading?.commands[0].words.map((word) => word.value)).toEqual(['a', '<<y']);
  });

  it('skips a comment and a backslash-newline between words', () => {
    expect(values('a # b "c\nd \\\n e')).toEqual([['a'], ['d', 'e']]);
  });

  it('reads ( ) groups and $(( )) as commands', () => {
    expect(values('(a; (b)) && x=$((1 + 2))')).toEqual([['a'], ['b'], ['1', '+', '2'], [null]]);
  });

  it('keeps a backslash inside double quotes only before a character it does not escape', () => {
    expect(values('x "a\\"b" "c\\qd" "e$"')).toEqual([['x', 'a"b', 'c\\qd', 'e$']]);
  });

  it('marks a word joined by a backslash-newline as executing and keeps its value', () => {
    const word = readShell('x a\\\nb')?.commands[0].words[1];
    expect([word?.value, word?.executes]).toEqual(['ab', true]);
  });

  it('gives a special parameter, a $"…" string and a word after an expansion no value', () => {
    const words = readShell('x $1 $?y $"msg" $X\'a\'')?.commands[0].words ?? [];
    expect(words.map((word) => [word.value, word.executes])).toEqual([
      ['x', false],
      [null, false],
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it('skips an escaped backtick inside backticks and an escaped quote inside $\'…\'', () => {
    const words = readShell("x `a\\`b` $'c\\'d' y")?.commands[0].words ?? [];
    expect(words.map((word) => [word.value, word.executes])).toEqual([
      ['x', false],
      [null, true],
      [null, true],
      ['y', false],
    ]);
  });

  it('reads <&, <> and &> as redirections that take a target', () => {
    expect(values('a <&3 <>f &>out b')).toEqual([['a', 'b']]);
  });

  it.each([
    ['an unterminated single quote', "a 'b"],
    ['an unterminated $\'…\'', "a $'b"],
    ['a trailing backslash inside double quotes', 'a "b\\'],
    ['a ;; outside case', 'a;; b'],
    ['a ;& outside case', 'a;& b'],
    ['an unterminated double quote', 'a "b'],
    ['an unterminated $( )', 'a $(b'],
    ['an unterminated backtick', 'a `b'],
    ['a backtick holding a heredoc', 'a `cat <<E`'],
    ['an unterminated heredoc', 'a <<E\nb'],
    ['a heredoc with no body line', 'a <<E'],
    ['a heredoc left open inside $( )', 'a $(b <<E)\nx\nE'],
    ['a case arm', 'case x in a) b;; esac'],
    ['an unmatched )', 'a )'],
    ['an unclosed (', '(a'],
    ['a function definition', 'f() { a; }'],
    ['$[ ]', 'a $[1]'],
    ['a quote inside ${ }', 'a ${x:-"y"}'],
    ['an expanding heredoc delimiter', 'a <<$E\nb\n$E'],
    ['a redirection with no target', 'a >'],
    ['a trailing backslash', 'a \\'],
    ['nesting past the bound', `${'$('.repeat(40)}a${')'.repeat(40)}`],
  ])('returns null for %s', (_label, command) => {
    expect(readShell(command)).toBeNull();
  });
});

describe('blankSpans', () => {
  it('blanks each span, keeps new lines, and tolerates overlap', () => {
    expect(blankSpans('ab\ncd ef', [[1, 5], [3, 6]])).toBe('a \n   ef');
  });

  it('returns the input when there is no span', () => {
    expect(blankSpans('abc', [])).toBe('abc');
  });
});
