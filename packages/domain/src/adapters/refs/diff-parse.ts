import type { DiffHunk, FileChange } from '../../ports/refs.js';

/**
 * Parses `git diff --no-renames -U0` output into one {@link FileChange} per file.
 *
 * With renames off, both sides of a `diff --git a/P b/P` header name the same
 * path, so the path is the header's two equal halves. A header that does not
 * split that way (git quotes a path holding a quote, tab or newline) keeps its
 * raw text as the path, which matches no allowed path in a caller.
 *
 * @param stdout - the diff text.
 * @returns the files in the diff's order. A file with a mode change, a type
 *   change or no text hunks (binary) reads as `other`.
 */
export const parseDiff = (stdout: string): FileChange[] => {
  const files: FileChange[] = [];
  let file: { path: string; status: FileChange['status']; hunks: DiffHunk[]; other: boolean } | null = null;
  let hunk: { section: string; removed: string[]; added: string[] } | null = null;
  const close = (): void => {
    if (file === null) return;
    files.push({ path: file.path, status: file.other ? 'other' : file.status, hunks: file.hunks });
    file = null;
    hunk = null;
  };
  for (const line of stdout.split('\n')) {
    if (line.startsWith('diff --git ')) {
      close();
      const rest = line.slice('diff --git '.length);
      const half = (rest.length - 1) / 2;
      const [left, right] = [rest.slice(0, half), rest.slice(half + 1)];
      const split = rest[half] === ' ' && left.startsWith('a/') && right.startsWith('b/') && left.slice(2) === right.slice(2);
      const path = split ? left.slice(2) : rest;
      file = { path, status: 'modified', hunks: [], other: false };
    } else if (file === null) {
      continue;
    } else if (hunk !== null && (line.startsWith('+') || line.startsWith('-'))) {
      (line[0] === '+' ? hunk.added : hunk.removed).push(line.slice(1));
    } else if (line.startsWith('@@')) {
      const section = /^@@ [^@]*@@ ?(.*)$/.exec(line)?.[1] ?? '';
      hunk = { section, removed: [], added: [] };
      file.hunks.push(hunk);
    } else if (line.startsWith('new file mode')) {
      file.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      file.status = 'deleted';
    } else if (/^(old mode|new mode|Binary files|GIT binary patch|similarity index|rename |copy )/.test(line) && hunk === null) {
      file.other = true;
    }
  }
  close();
  return files;
};
