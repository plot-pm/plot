// Prunes stale vendored helper copies from the board package root. See
// build.mjs's `vendoredScripts` comment for why the copies exist; this
// removes a copy whose name left that list, which the copy loop alone never
// does (#1344).
import fs from 'node:fs';
import path from 'node:path';

export const pruneStaleVendoredHelpers = (dir, keepNames) => {
  const keep = new Set(keepNames);
  const removed = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!/^plot-.*\.sh$/.test(entry.name)) continue;
    if (keep.has(entry.name)) continue;
    fs.rmSync(path.join(dir, entry.name));
    removed.push(entry.name);
  }
  return removed;
};
