import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { answered, type PortResult } from '../../port-result.js';
import type { ActionReceipts } from '../../ports/action-receipts.js';

/**
 * Reads receipts from `<repoRoot>/.plot/state/action-receipts/`, the directory
 * `plot-state-receipt.sh`'s `_action_receipt_dir` names.
 *
 * A missing or unreadable file answers `false`. The file is never deleted.
 *
 * @param repoRoot - the repository's top-level directory.
 */
export const actionReceiptsFile = (repoRoot: string): ActionReceipts => ({
  clears: async (action): Promise<PortResult<boolean>> => {
    try {
      return answered((await stat(join(repoRoot, '.plot', 'state', 'action-receipts', action))).isFile());
    } catch {
      return answered(false);
    }
  },
});
