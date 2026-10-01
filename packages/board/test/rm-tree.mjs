// The one recursive removal under packages/board/test. CI's *A teardown does
// not race a child* step allows exactly one raw recursive `fs.rmSync` here, and
// this is it: `helpers.mjs`'s `rmTree` and the catalogue's browser launcher
// both call it, and the catalogue must not import `helpers.mjs`.
import fs from 'node:fs';

/**
 * Delete a fixture tree, retrying only while a dying process still writes into
 * it.
 *
 * `after()` hooks await `server.stop()`, but that resolves when the SERVER
 * exits — not when the `git` children it spawned mid-scan do. A grandchild is
 * outside the scope of the SIGTERM sent to its parent, so it can still create
 * `.git/index.lock` or an object file a few milliseconds after the server is
 * gone. `rmSync` walks a directory, deletes what it saw, then `rmdir`s the
 * parent; a file appearing between those two steps fails the `rmdir` with
 * ENOTEMPTY. CI failed exactly this way on `outer/.git`.
 *
 * `force: true` does not cover this. It suppresses "no such file" — the
 * absence of something expected — while this is the presence of something
 * unexpected, the opposite failure.
 *
 * This is the same reasoning as `helpers.mjs`'s `git` retry, applied to the other half of the
 * fixture's life: contention with a doomed process is transient by definition,
 * so a bounded retry converts a spurious teardown failure into a marginally
 * slower one. Awaiting the server was the previous attempt at this and did not
 * hold, because it addressed the process that was waited for rather than the
 * ones that were not.
 *
 * Bounded and specific for the same reason the git retry is: ENOTEMPTY/EBUSY
 * clear on their own, and any other error means the fixture is wrong in a way
 * patience cannot fix, so it must surface on the first attempt.
 */
const STILL_BEING_WRITTEN = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM']);

export const removeTree = (target, { retries = 10, delayMs = 25 } = {}) => {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt >= retries || !STILL_BEING_WRITTEN.has(err?.code)) throw err;
      // Synchronous, to stay a drop-in for the `fs.rmSync` calls it replaces:
      // `after()` hooks are not all async, and making them so to accommodate a
      // cleanup helper would spread this detail across every suite.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
};
