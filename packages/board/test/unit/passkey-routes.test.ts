// The passkey routes: a release approval needs a verified, single-use assertion
// bound to its (pr, sha), and a verified assertion reads `person` on the two
// routes that otherwise read the board's own environment.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FleetReading } from '@plot-pm/domain';
import { actionReceiptPath } from '../../src/server/action-receipt.js';
import { challengeStore } from '../../src/server/passkey-challenges.js';
import { handlePasskeyChallenge, handlePasskeyRegister, handleReleaseApprove, type PasskeyDeps } from '../../src/server/passkey.js';
import { handleRestart } from '../../src/server/restart.js';
import { passkeyFile } from '@plot-pm/domain/adapters/passkey/passkey-file';

const PORT = 4399;
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

const request = (body: unknown): http.IncomingMessage => {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
};

const response = () => {
  const out: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(text?: string) {
      out.body = text ? JSON.parse(text) : {};
    },
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, out };
};

const spki = (key: KeyObject): string => key.export({ type: 'spki', format: 'der' }).toString('base64url');

/** A user-verified assertion over the given challenge, signed as the platform authenticator would. */
const assertionFor = (privateKey: KeyObject, challenge: string, signCount: number) => {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: `http://localhost:${PORT}` }));
  const authData = Buffer.alloc(37);
  createHash('sha256').update('localhost').digest().copy(authData, 0);
  authData[32] = 0x05;
  authData.writeUInt32BE(signCount, 33);
  const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), privateKey);
  return {
    credentialId: 'cred-1',
    authenticatorData: authData.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    signature: signature.toString('base64url'),
  };
};

describe('the passkey routes', () => {
  let root: string;
  let now: number;
  let privateKey: KeyObject;
  let deps: PasskeyDeps;
  let opts: never;
  let counter: number;
  const saved = process.env.PLOT_UNATTENDED;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'passkey-routes-'));
    now = 1_000_000;
    counter = 0;
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = pair.privateKey;
    deps = { passkey: passkeyFile(root), challenges: challengeStore(() => now), now: () => now, finish: () => undefined };
    opts = { host: '127.0.0.1', port: PORT, repoRoot: root, scriptsDir: '/nonexistent' } as never;
    await passkeyFile(root).register({ v: 1, credentialId: 'cred-1', publicKey: spki(pair.publicKey), signCount: 0, registeredAt: 'then' });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PLOT_UNATTENDED;
    else process.env.PLOT_UNATTENDED = saved;
    rmSync(root, { recursive: true, force: true });
  });

  const challengeFor = async (what: Record<string, unknown>): Promise<string> => {
    const { res, out } = response();
    await handlePasskeyChallenge(request(what), res, opts, deps);
    expect(out.status).toBe(200);
    return out.body.challenge as string;
  };
  const signed = (challenge: string) => assertionFor(privateKey, challenge, ++counter);

  describe('POST /api/release-approve', () => {
    for (const unattended of [undefined, '0', '1']) {
      it(`without an assertion refuses person-unproven with PLOT_UNATTENDED ${unattended ?? 'unset'}`, async () => {
        if (unattended === undefined) delete process.env.PLOT_UNATTENDED;
        else process.env.PLOT_UNATTENDED = unattended;
        const { res, out } = response();
        await handleReleaseApprove(request({ pr: 7, sha: SHA }), res, opts, deps);
        expect(out.status).toBe(409);
        expect(out.body).toMatchObject({ approved: false, reason: 'person-unproven' });
      });
    }

    it('a verified assertion passes the proof check and writes a receipt naming the credential id', async () => {
      process.env.PLOT_UNATTENDED = '1';
      const challenge = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      const { res, out } = response();
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion: signed(challenge) }), res, opts, deps);
      // The host is unreachable here, so the approval refuses later than the proof.
      expect(out.body.reason).not.toBe('person-unproven');
      expect(out.body.reason).not.toBe('unattended');
      expect(readFileSync(actionReceiptPath(root, 'release-approve'), 'utf8')).toContain('passkey:cred-1');
    });

    it('refuses a replayed challenge as challenge-expired', async () => {
      const challenge = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      const assertion = signed(challenge);
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion }), response().res, opts, deps);
      const { res, out } = response();
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion: signed(challenge) }), res, opts, deps);
      expect(out).toMatchObject({ status: 403, body: { approved: false, reason: 'challenge-expired' } });
    });

    it('refuses a challenge 121 s old as challenge-expired, and accepts one 120 s old', async () => {
      const stale = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      now += 121_000;
      const late = response();
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion: signed(stale) }), late.res, opts, deps);
      expect(late.out).toMatchObject({ status: 403, body: { reason: 'challenge-expired' } });

      const fresh = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      now += 120_000;
      const edge = response();
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion: signed(fresh) }), edge.res, opts, deps);
      expect(edge.out.body.reason).not.toBe('challenge-expired');
    });

    it('does not approve a different sha with a challenge issued for another', async () => {
      const challenge = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      const { res, out } = response();
      await handleReleaseApprove(request({ pr: 7, sha: OTHER_SHA, assertion: signed(challenge) }), res, opts, deps);
      expect(out).toMatchObject({ status: 403, body: { approved: false, reason: 'challenge-expired' } });
    });

    it('names the failed check where the assertion is signed by another key', async () => {
      const challenge = await challengeFor({ action: 'release-approve', pr: 7, sha: SHA });
      const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
      const { res, out } = response();
      await handleReleaseApprove(request({ pr: 7, sha: SHA, assertion: assertionFor(other, challenge, 1) }), res, opts, deps);
      expect(out).toMatchObject({ status: 403, body: { reason: 'passkey-refused' } });
      expect(String(out.body.detail)).toContain('signature');
    });
  });

  describe('POST /api/passkey/challenge', () => {
    it('refuses passkey-unregistered where no credential is stored', async () => {
      const empty = mkdtempSync(path.join(tmpdir(), 'passkey-empty-'));
      try {
        const { res, out } = response();
        await handlePasskeyChallenge(request({ action: 'restart', branch: 'feature/x' }), res, opts, { ...deps, passkey: passkeyFile(empty) });
        expect(out).toMatchObject({ status: 409, body: { reason: 'passkey-unregistered' } });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });

  describe('POST /api/passkey/register', () => {
    it('keeps the first registration and refuses a second without an assertion', async () => {
      const { res, out } = response();
      await handlePasskeyRegister(request({ credentialId: 'cred-2', publicKey: 'AAAA', alg: -7 }), res, opts, deps);
      expect(out).toMatchObject({ status: 409, body: { reason: 'passkey-exists' } });
      const held = await passkeyFile(root).read();
      expect(held.ok && held.value?.credentialId).toBe('cred-1');
    });

    it('refuses an algorithm other than ES256', async () => {
      const { res, out } = response();
      await handlePasskeyRegister(request({ credentialId: 'cred-2', publicKey: 'AAAA', alg: -257 }), res, opts, deps);
      expect(out.status).toBe(400);
      expect(out.body.reason).toBe('passkey-refused');
    });

    it('replaces the credential on an assertion from the registered one', async () => {
      const challenge = await challengeFor({ action: 'passkey-replace' });
      const { res, out } = response();
      await handlePasskeyRegister(request({ credentialId: 'cred-2', publicKey: 'AAAA', alg: -7, assertion: signed(challenge) }), res, opts, deps);
      expect(out.status).toBe(200);
      const held = await passkeyFile(root).read();
      expect(held.ok && held.value?.credentialId).toBe('cred-2');
    });
  });

  describe('POST /api/restart', () => {
    // A desk with an empty config: a person caller reaches `no-worker-command`
    // and an unattended one refuses `unattended`, so nothing is ever started.
    let desk: string;
    let pulse: FleetReading;
    const readers = { pr: async () => ({ reachedReview: false as const, number: 0, state: '' }), worker: async () => 'running' as never };
    const deskDeps = () => ({ pulse: () => pulse, readers, config: (() => '') as never });
    beforeEach(() => {
      desk = mkdtempSync(path.join(tmpdir(), 'passkey-desk-'));
      pulse = {
        main: 'main',
        plans: [{ file: 'p.md', slices: [{ name: 's', branches: [{ branch: 'feature/desk', local_worktree: desk, worker: 'running', worker_pid: '' }] }] }],
      } as unknown as FleetReading;
    });
    afterEach(() => rmSync(desk, { recursive: true, force: true }));

    it('reads person for a verified assertion on a board started under PLOT_UNATTENDED=1', async () => {
      process.env.PLOT_UNATTENDED = '1';
      const bare = response();
      await handleRestart(request({ branch: 'feature/desk' }), bare.res, opts as never, deskDeps());
      expect(bare.out.body.reason).toBe('unattended');

      const challenge = await challengeFor({ action: 'restart', branch: 'feature/desk' });
      const proved = response();
      await handleRestart(request({ branch: 'feature/desk', assertion: signed(challenge) }), proved.res, opts as never, { ...deskDeps(), passkey: deps });
      // Past the caller check; the empty config then stops the start itself.
      expect(proved.out.body.reason).toBe('no-worker-command');
    });

    it('refuses an assertion bound to another branch', async () => {
      const challenge = await challengeFor({ action: 'restart', branch: 'feature/other' });
      const { res, out } = response();
      await handleRestart(request({ branch: 'feature/desk', assertion: signed(challenge) }), res, opts as never, { ...deskDeps(), passkey: deps });
      expect(out).toMatchObject({ status: 403, body: { reason: 'challenge-expired' } });
    });
  });
});
