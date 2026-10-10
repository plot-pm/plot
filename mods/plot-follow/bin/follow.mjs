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
import { connect } from 'node:net';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: follow.mjs <repo root>');
  process.exit(2);
}

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
    process.stdout.write(`${line}\n`);
    // A served or refused subscription is over; the channel closes after it.
    const type = line.startsWith('{') ? (JSON.parse(line).type ?? '') : '';
    if (type === 'served' || type === 'refused') socket.end();
  }
});
socket.on('error', (error) => {
  console.error(error.message);
  process.exit(2);
});
socket.on('close', () => process.exit(0));
