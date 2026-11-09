import { describe, expect, it } from 'vitest';

import { parseTree } from '../src/rules/git-tree.js';

const encoder = new TextEncoder();

/** One tree entry's bytes: `<mode> <name>\0<raw oid>`. */
const entry = (mode: string, name: string, oidHex: string): Uint8Array => {
  const head = encoder.encode(`${mode} ${name}\0`);
  const oid = Uint8Array.from(oidHex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  const out = new Uint8Array(head.length + oid.length);
  out.set(head);
  out.set(oid, head.length);
  return out;
};

const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const A = '0123456789abcdef0123456789abcdef01234567';
const B = 'fedcba9876543210fedcba9876543210fedcba98';

describe('parseTree', () => {
  it('reads blobs, symlinks, executables, subtrees and submodules in stored order', () => {
    const body = join(
      entry('100644', 'a.md', A),
      entry('100755', 'run.sh', B),
      entry('120000', 'link', A),
      entry('40000', 'plans', B),
      entry('160000', 'vendor', A),
    );
    expect(parseTree(body, 20)).toEqual([
      { mode: '100644', kind: 'blob', name: 'a.md', oid: A },
      { mode: '100755', kind: 'blob', name: 'run.sh', oid: B },
      { mode: '120000', kind: 'blob', name: 'link', oid: A },
      { mode: '040000', kind: 'tree', name: 'plans', oid: B },
      { mode: '160000', kind: 'commit', name: 'vendor', oid: A },
    ]);
  });

  it('decodes a name holding — and → as UTF-8', () => {
    expect(parseTree(entry('100644', 'a — b → c.md', A), 20)).toEqual([
      { mode: '100644', kind: 'blob', name: 'a — b → c.md', oid: A },
    ]);
  });

  it('reads a SHA-256 object id of 32 bytes', () => {
    const long = A + A.slice(0, 24);
    expect(parseTree(entry('100644', 'x', long), 32)).toEqual([{ mode: '100644', kind: 'blob', name: 'x', oid: long }]);
  });

  it('reads an empty tree as no entries', () => {
    expect(parseTree(new Uint8Array(0), 20)).toEqual([]);
  });

  it.each([
    ['no space after the mode', encoder.encode('100644')],
    ['no NUL after the name', encoder.encode('100644 name')],
    ['a truncated object id', entry('100644', 'x', A).subarray(0, 20)],
    ['a mode that is not octal', entry('10064x', 'x', A)],
    ['a mode git does not write', entry('070000', 'x', A)],
    ['an empty name', entry('100644', '', A)],
    ['a name holding /', entry('100644', 'a/b', A)],
  ])('answers null for %s', (_, body) => {
    expect(parseTree(body, 20)).toBeNull();
  });
});
