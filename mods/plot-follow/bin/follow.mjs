// Prints the Plot fleet channel's messages as one JSON line each.
//
//   node follow.mjs <repo root>
//
// Exit 0: the channel closed or ended the subscription. Exit 2: no channel is
// listening; the reason goes to stderr.
//
// DECLARED DUPLICATE of packages/domain/src/adapters/channel/channel-client.ts.
// A mod installs as its own folder and cannot load that file. The wire format
// is NDJSON over the unix socket <repo root>/.plot/fleet.sock; this file writes
// the subscribe request and relays the lines. packages/domain/test/
// follow-channel-follower.test.ts runs it against a real startChannel socket.
//
// THE CLAIM. Every session of one repository runs its own follower and hears
// the same findings. Each reading is claimed by creating one lease file with
// O_EXCL under <repo root>/.plot/state/follow-leases/, so exactly one follower
// in the repository wins it. The follower adds `claimed` to what it relays: a
// boolean on a `finding` line, and one boolean per entry of a `welcome`'s
// `current`. The mod starts a turn only for a claimed reading. The mod's
// `$.store` has no compare-and-set, so this file is where the claim is atomic.
// A lease is per reading, so a claimer that crashes blocks that reading alone;
// a lease older than LEASE_MS is removed when a follower starts. A lease that
// cannot be written counts as claimed, and the reason goes to stderr.
// The reading's fields are those of readingOf and slotOf in
// hooks/follow-channel.ts.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const LEASE_MS = 24 * 60 * 60 * 1000;

const root = process.argv[2];
if (!root) {
  console.error('usage: follow.mjs <repo root>');
  process.exit(2);
}

const leases = join(root, '.plot', 'state', 'follow-leases');

const prune = () => {
  let names = [];
  try {
    names = readdirSync(leases);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(leases, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > LEASE_MS) unlinkSync(path);
    } catch {
      // Another follower removed it first.
    }
  }
};

/** Whether this follower won the reading's lease; a `clear` is never claimed. */
const claim = (finding) => {
  if (!finding || finding.finding === 'clear') return false;
  const { monitor, branch, finding: name, since, evidence } = finding;
  const key = createHash('sha256').update(JSON.stringify([monitor, branch, name, since, evidence])).digest('hex');
  try {
    mkdirSync(leases, { recursive: true });
    closeSync(openSync(join(leases, key), 'wx'));
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    console.error(`follow.mjs: cannot write a lease, so this session claims the reading: ${error.message}`);
    return true;
  }
};

/** The line as relayed: a finding or a welcome carries its claim. */
const relay = (message) => {
  if (message.type === 'finding') return { ...message, claimed: claim(message.finding) };
  if (message.type === 'welcome') return { ...message, claimed: (message.current ?? []).map(claim) };
  return message;
};

prune();

const socket = connect(join(root, '.plot', 'fleet.sock'));
socket.setEncoding('utf8');
socket.on('connect', () => {
  socket.write(`${JSON.stringify({ subscriber: 'plot-follow', purpose: { kind: 'everything' } })}\n`);
});

let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (line === '') continue;
    if (!line.startsWith('{')) {
      process.stdout.write(`${line}\n`);
      continue;
    }
    const message = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(relay(message))}\n`);
    // A served or refused subscription is over; the channel closes after it.
    if (message.type === 'served' || message.type === 'refused') socket.end();
  }
});
socket.on('error', (error) => {
  console.error(error.message);
  process.exit(2);
});
socket.on('close', () => process.exit(0));
