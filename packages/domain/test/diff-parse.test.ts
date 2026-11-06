import { describe, expect, it } from 'vitest';

import { parseDiff } from '../src/adapters/refs/diff-parse.js';

const DIFF = [
  'diff --git a/.changeset/a.md b/.changeset/a.md',
  'deleted file mode 100644',
  'index 1111111..0000000',
  '--- a/.changeset/a.md',
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  '----',
  "-'plot': patch",
  '----',
  'diff --git a/package.json b/package.json',
  'index 2222222..3333333 100644',
  '--- a/package.json',
  '+++ b/package.json',
  '@@ -3 +3 @@',
  '-  "version": "2.30.0",',
  '+  "version": "2.31.0",',
  'diff --git a/skills/plot/SKILL.md b/skills/plot/SKILL.md',
  'index 4444444..5555555 100644',
  '--- a/skills/plot/SKILL.md',
  '+++ b/skills/plot/SKILL.md',
  '@@ -11 +11 @@ metadata:',
  '-  version: 0.19.0',
  '+  version: 0.20.0',
  'diff --git a/run.sh b/run.sh',
  'old mode 100644',
  'new mode 100755',
  'diff --git a/logo.png b/logo.png',
  'index 6666666..7777777 100644',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/new.txt b/new.txt',
  'new file mode 100644',
  'index 0000000..8888888',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1 @@',
  '+--- not a header',
  '',
].join('\n');

describe('parseDiff', () => {
  const files = parseDiff(DIFF);

  it('reads each file with its path and status', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['.changeset/a.md', 'deleted'],
      ['package.json', 'modified'],
      ['skills/plot/SKILL.md', 'modified'],
      ['run.sh', 'other'],
      ['logo.png', 'other'],
      ['new.txt', 'added'],
    ]);
  });

  it('keeps the removed and added lines of a hunk, and the section git printed', () => {
    expect(files[1]!.hunks).toEqual([{ section: '', removed: ['  "version": "2.30.0",'], added: ['  "version": "2.31.0",'] }]);
    expect(files[2]!.hunks[0]!.section).toBe('metadata:');
  });

  it('reads a deleted file\'s lines as removed, including a line that begins with dashes', () => {
    expect(files[0]!.hunks[0]!.removed).toEqual(['---', "'plot': patch", '---']);
    expect(files[5]!.hunks[0]!.added).toEqual(['--- not a header']);
  });

  it('answers no files for an empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
