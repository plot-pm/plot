// A registry stand-in for loop tests: it hands slices to a free agent.
//
// The loop in `plot-worker-loop.sh` asked the fleet scan for work, so a test
// wrapped `plot-fleet-scan.sh` in a shim that wrote the next branch into the
// manifest. The JS loop never calls the scan; it polls the manifest the
// registry writes. This watcher plays that registry on both loops: when the
// manifest names no branch it writes the next queued one, by rename, so the
// loop never reads half a manifest.
import { spawn } from 'node:child_process';

/**
 * Starts a watcher process. Each time the manifest holds an empty `branch` it
 * takes the next entry of `handOvers` and writes it; it stops when the queue is
 * empty. An empty-string entry is skipped, so `''` means "hand nothing over".
 *
 * @param {string} manifest absolute path of the agent manifest
 * @param {string | string[]} handOvers branches to hand over, one per free window
 * @param {string} [snapshotLog] file that receives the manifest text read at each hand-over
 * @returns {import('node:child_process').ChildProcess} the watcher; the caller kills it
 */
export const registryWatcher = (manifest, handOvers, snapshotLog = '') => {
  const queue = [handOvers].flat().filter((b) => b !== '');
  const script = `
    const fs = require('fs');
    const [manifest, snapshotLog, ...queue] = process.argv.slice(1);
    if (queue.length === 0) process.exit(0);
    const tick = () => {
      let text;
      try { text = fs.readFileSync(manifest, 'utf8'); } catch { return; }
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.branch !== '') return;
      if (snapshotLog !== '') fs.appendFileSync(snapshotLog, text + '\\n--SNAP--\\n');
      m.branch = queue.shift();
      fs.writeFileSync(manifest + '.watch-tmp', JSON.stringify(m, null, 2) + '\\n');
      fs.renameSync(manifest + '.watch-tmp', manifest);
      if (queue.length === 0) process.exit(0);
    };
    setInterval(tick, 100);
  `;
  return spawn(process.execPath, ['-e', script, manifest, snapshotLog, ...queue], { stdio: 'ignore' });
};
