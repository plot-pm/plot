// `stateSyncRecordFor` holds one record per repository, so the record's own
// cache of the common git directory lasts the process, not one build.
import { describe, expect, it } from 'vitest';
import { stateSyncRecordFor } from '../../src/server/board.js';

describe('stateSyncRecordFor', () => {
  it('answers the same record for one repository and another for a second', () => {
    const first = stateSyncRecordFor('/repo/a');
    expect(stateSyncRecordFor('/repo/a')).toBe(first);
    expect(stateSyncRecordFor('/repo/b')).not.toBe(first);
  });
});
