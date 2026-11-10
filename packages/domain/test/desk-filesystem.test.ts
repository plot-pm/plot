import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { filesystemTypeOf } from '../src/adapters/desk/desk-filesystem.js';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'plot-desk-fs-')));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('filesystemTypeOf', () => {
  it('reads a local type for a temp directory, through its nearest existing parent', () => {
    const type = filesystemTypeOf(join(dir, 'not', 'yet'));
    expect(type).not.toBeNull();
    expect(['nfs', 'smbfs', 'cifs', 'afpfs', 'webdav']).not.toContain(type);
  });

  it('answers null on a platform it does not read', () => {
    expect(filesystemTypeOf(dir, 'win32')).toBeNull();
  });
});
