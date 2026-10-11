import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { answered, type PortResult } from '../../port-result.js';
import type { StateReceipts } from '../../ports/state-receipts.js';

/**
 * Spends receipts from `<repoRoot>/.plot/state/state-receipts/`, the
 * directory `plot-state-receipt.sh`'s `_receipt_dir` names.
 *
 * A missing, unreadable or malformed file answers `false`: an unreadable
 * receipt is no receipt, so the gate refuses, as `receipt_clears` does.
 *
 * @param repoRoot - the repository's top-level directory.
 * @param oidOf - the git blob object name of a string, as `git hash-object --stdin`
 *   computes it; the receipt's filename is `oidOf(relPath)`. Passed in so the
 *   hash has one implementation, `entry/ladder.ts`'s `gitBlobOid`.
 */
export const stateReceiptsFile = (repoRoot: string, oidOf: (content: string) => string): StateReceipts => ({
  spend: async (relPath, value): Promise<PortResult<boolean>> => {
    const file = join(repoRoot, '.plot', 'state', 'state-receipts', oidOf(relPath));
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return answered(false);
    }
    // `cut -f2` on the one line the writer wrote; command substitution drops the newline.
    const recorded = (text.split('\n')[0] ?? '').split('\t')[1];
    if (recorded !== value) return answered(false);
    try {
      await unlink(file);
    } catch {
      // The shell's `rm -f` ignores a failed delete; so does the spend.
    }
    return answered(true);
  },
});
