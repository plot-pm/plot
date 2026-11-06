import fs from 'node:fs';
import http from 'node:http';
import { passkeyFile } from '@plot-pm/domain/adapters/passkey/passkey-file';
import { COSE_ES256, PASSKEY_VERSION } from '@plot-pm/domain/entities/passkey';
import type { Passkey, PasskeyAssertion } from '@plot-pm/domain/ports/passkey';
import { agentLogPath } from './agent-log.js';
import { recordActionReceipt } from './action-receipt.js';
import type { BuildBoardOptions } from './board.js';
import { isSameOrigin, readJsonBody } from './dispatch.js';
import { finishContextFor, mergePortsFor } from './entry/merge-ports.js';
import { finishRelease } from './entry/release-finish.js';
import { releaseApproveAt } from './entry/release-approve.js';
import { boardChallenges, CHALLENGE_TTL_MS, type ChallengeStore } from './passkey-challenges.js';

/** The relying party id. An IP address is not a valid one, so the board is opened as `localhost`. */
export const RP_ID = 'localhost';

/** The options every passkey route takes. */
export interface PasskeyRouteOptions extends BuildBoardOptions {
  host: string;
  port: number;
}

/** What a route takes from outside itself; a test replaces each. */
export interface PasskeyDeps {
  /** The credential store; the file under `.plot/state/` where absent. */
  passkey?: Passkey;
  /** The challenges issued; the board process's own where absent. */
  challenges?: ChallengeStore;
  /** The clock, in epoch milliseconds. */
  now?: () => number;
  /** Starts the finish after a merge; the real finish where absent. */
  finish?: (opts: BuildBoardOptions, pr: number) => void;
}

/** Why a passkey step refused. */
export type PasskeyRefusal = 'passkey-unregistered' | 'passkey-refused' | 'challenge-expired';

/** The subject a challenge approves. */
export type PasskeyAction =
  | { action: 'release-approve'; pr: number; sha: string }
  | { action: 'release'; slug: string }
  | { action: 'restart'; branch: string }
  | { action: 'passkey-replace' };

/**
 * The string a challenge is bound to.
 *
 * @param what - the subject the assertion approves.
 * @returns a key; two subjects share one only where they are the same approval.
 */
export const bindingOf = (what: PasskeyAction): string => {
  switch (what.action) {
    case 'release-approve': return `release-approve:${what.pr}:${what.sha.toLowerCase()}`;
    case 'release': return `release:${what.slug}`;
    case 'restart': return `restart:${what.branch}`;
    case 'passkey-replace': return 'passkey-replace';
  }
};

/** What {@link verifyBound} answers. */
export type Verified =
  | { ok: true; credentialId: string }
  | { ok: false; reason: PasskeyRefusal; detail: string };

const field = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length < 8192;

/**
 * Reads an assertion off a request body.
 *
 * @param raw - the body's `assertion` member.
 * @returns the assertion, or null where a field is missing or not a string.
 */
export const assertionOf = (raw: unknown): PasskeyAssertion | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (!field(a.credentialId) || !field(a.authenticatorData) || !field(a.clientDataJSON) || !field(a.signature)) return null;
  return { credentialId: a.credentialId, authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON, signature: a.signature };
};

/**
 * Spends the assertion's challenge for one subject and verifies the assertion.
 *
 * The challenge is spent first and whatever the verdict, so a replayed or
 * failed assertion cannot be tried again on the same challenge.
 *
 * @param assertion - the browser's assertion.
 * @param what - the subject the person approves.
 * @param opts - the board's options; the port names the origin.
 * @param deps - the store, challenges and clock.
 * @returns the verified credential id, or the refusal naming why.
 */
export const verifyBound = async (
  assertion: PasskeyAssertion,
  what: PasskeyAction,
  opts: { port: number; repoRoot: string },
  deps: PasskeyDeps = {},
): Promise<Verified> => {
  const store = deps.passkey ?? passkeyFile(opts.repoRoot);
  let challenge = '';
  try {
    const client = JSON.parse(Buffer.from(assertion.clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
    challenge = typeof client.challenge === 'string' ? client.challenge : '';
  } catch {
    return { ok: false, reason: 'passkey-refused', detail: 'the assertion failed the malformed check.' };
  }
  if ((deps.challenges ?? boardChallenges).consume(challenge, bindingOf(what)) !== 'ok') {
    return { ok: false, reason: 'challenge-expired', detail: `the challenge is unknown, spent, bound to another subject or older than ${CHALLENGE_TTL_MS / 1000} s. Ask for a new one.` };
  }
  const out = await store.verify(assertion, { challenge, origin: `http://localhost:${opts.port}`, rpId: RP_ID });
  if (!out.ok) return { ok: false, reason: 'passkey-refused', detail: 'the credential store could not be read.' };
  if (out.value.kind === 'unregistered') {
    return { ok: false, reason: 'passkey-unregistered', detail: 'no passkey is registered. Register one on the board first.' };
  }
  if (out.value.kind === 'refused') {
    return { ok: false, reason: 'passkey-refused', detail: `the assertion failed the ${out.value.check} check.` };
  }
  return { ok: true, credentialId: out.value.credentialId };
};

const respond = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = async (req: http.IncomingMessage, res: http.ServerResponse, port: number): Promise<Record<string, unknown> | null> => {
  if (!isSameOrigin(req, port)) {
    respond(res, 403, { error: 'cross-origin request refused' });
    return null;
  }
  try {
    const body = await readJsonBody(req, 16384);
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  } catch (err) {
    respond(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
};

/**
 * Reads the optional assertion on `/api/release` and `/api/restart`.
 *
 * @param body - the request body.
 * @param what - the subject the route acts on.
 * @param opts - the board's options.
 * @param deps - the store, challenges and clock.
 * @returns `none` where the body carries no assertion; otherwise the verdict.
 */
export const optionalProof = async (
  body: unknown,
  what: PasskeyAction,
  opts: { port: number; repoRoot: string },
  deps: PasskeyDeps = {},
): Promise<{ kind: 'none' } | { kind: 'verified'; credentialId: string } | { kind: 'refused'; reason: PasskeyRefusal; detail: string }> => {
  const raw = (body as { assertion?: unknown } | null)?.assertion;
  if (raw === undefined) return { kind: 'none' };
  const assertion = assertionOf(raw);
  if (assertion === null) return { kind: 'refused', reason: 'passkey-refused', detail: 'the assertion failed the malformed check.' };
  const out = await verifyBound(assertion, what, opts, deps);
  return out.ok ? { kind: 'verified', credentialId: out.credentialId } : { kind: 'refused', reason: out.reason, detail: out.detail };
};

/** `GET /api/passkey` — the registered credential, for the board's registration line. */
export const handlePasskeyState = async (
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: BuildBoardOptions,
  deps: PasskeyDeps = {},
): Promise<void> => {
  const held = await (deps.passkey ?? passkeyFile(opts.repoRoot)).read();
  if (!held.ok) return respond(res, 500, { error: 'the credential store could not be read' });
  respond(res, 200, held.value === null
    ? { registered: false, rpId: RP_ID }
    : { registered: true, rpId: RP_ID, credentialId: held.value.credentialId, registeredAt: held.value.registeredAt });
};

/** `POST /api/passkey/challenge` — issues a challenge bound to the subject in the body. */
export const handlePasskeyChallenge = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: PasskeyRouteOptions,
  deps: PasskeyDeps = {},
): Promise<void> => {
  const body = await readBody(req, res, opts.port);
  if (body === null) return;
  let what: PasskeyAction | null = null;
  if (body.action === 'release-approve' && typeof body.pr === 'number' && Number.isInteger(body.pr) && typeof body.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(body.sha)) {
    what = { action: 'release-approve', pr: body.pr, sha: body.sha };
  } else if (body.action === 'release' && typeof body.slug === 'string' && body.slug !== '') {
    what = { action: 'release', slug: body.slug };
  } else if (body.action === 'restart' && typeof body.branch === 'string' && body.branch !== '') {
    what = { action: 'restart', branch: body.branch };
  } else if (body.action === 'passkey-replace') {
    what = { action: 'passkey-replace' };
  }
  if (what === null) return respond(res, 400, { error: 'action must be release-approve with pr and sha, release with slug, restart with branch, or passkey-replace' });
  const held = await (deps.passkey ?? passkeyFile(opts.repoRoot)).read();
  if (!held.ok) return respond(res, 500, { error: 'the credential store could not be read' });
  if (held.value === null) {
    return respond(res, 409, { ok: false, reason: 'passkey-unregistered', detail: 'no passkey is registered. Register one on the board first.' });
  }
  const challenge = (deps.challenges ?? boardChallenges).issue(bindingOf(what));
  respond(res, 200, { challenge, rpId: RP_ID, origin: `http://localhost:${opts.port}`, credentialId: held.value.credentialId, expiresInMs: CHALLENGE_TTL_MS });
};

/**
 * `POST /api/passkey/register` — stores the credential a `navigator.credentials.create` made.
 *
 * The first registration wins. A second needs an assertion from the registered
 * credential; the store is never overwritten otherwise. Only ES256 is accepted.
 */
export const handlePasskeyRegister = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: PasskeyRouteOptions,
  deps: PasskeyDeps = {},
): Promise<void> => {
  const body = await readBody(req, res, opts.port);
  if (body === null) return;
  if (!field(body.credentialId) || !field(body.publicKey)) {
    return respond(res, 400, { error: 'credentialId and publicKey are required' });
  }
  if (body.alg !== COSE_ES256) {
    return respond(res, 400, { ok: false, reason: 'passkey-refused', detail: `only ES256 (${COSE_ES256}) registers; the authenticator reported ${String(body.alg)}.` });
  }
  const store = deps.passkey ?? passkeyFile(opts.repoRoot);
  const record = {
    v: PASSKEY_VERSION,
    credentialId: body.credentialId,
    publicKey: body.publicKey,
    signCount: 0,
    registeredAt: new Date((deps.now ?? Date.now)()).toISOString(),
  } as const;
  const wrote = await store.register(record);
  if (!wrote.ok) return respond(res, 500, { error: 'the credential store could not be written' });
  if (wrote.value === 'registered') return respond(res, 200, { ok: true, credentialId: record.credentialId, registeredAt: record.registeredAt });
  const proof = await optionalProof(body, { action: 'passkey-replace' }, opts, deps);
  if (proof.kind === 'none') {
    return respond(res, 409, { ok: false, reason: 'passkey-exists', detail: 'a passkey is already registered. Replacing it needs an assertion from the registered credential.' });
  }
  if (proof.kind === 'refused') return respond(res, 403, { ok: false, reason: proof.reason, detail: proof.detail });
  const replaced = await store.replace(record);
  if (!replaced.ok) return respond(res, 500, { error: 'the credential store could not be written' });
  respond(res, 200, { ok: true, credentialId: record.credentialId, registeredAt: record.registeredAt, replaced: true });
};

/** Runs the finish after a merge, logging to the release-approve log; its words are the record. */
const startFinish = (opts: BuildBoardOptions, pr: number): void => {
  const log = agentLogPath(opts.repoRoot, 'release', `approve-${pr}`, 'log');
  const line = (s: string): void => {
    try { fs.appendFileSync(log, s, 'utf8'); } catch { /* the log is a convenience */ }
  };
  void (async () => {
    try {
      const ports = await mergePortsFor(opts, 'person');
      await finishRelease(finishContextFor(opts, ports), pr, line, line);
    } catch (err) {
      line(`finish failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  })();
};

/**
 * `POST /api/release-approve` with `{ pr, sha, assertion }`.
 *
 * Verifies the assertion against a challenge issued for exactly this `(pr, sha)`,
 * then approves and merges through `releaseApproveAt` with the credential id as
 * the proof. Without an assertion it refuses `person-unproven`, whatever the
 * board's own `PLOT_UNATTENDED` reads.
 */
export const handleReleaseApprove = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: PasskeyRouteOptions,
  deps: PasskeyDeps = {},
): Promise<void> => {
  const body = await readBody(req, res, opts.port);
  if (body === null) return;
  const { pr, sha } = body;
  if (typeof pr !== 'number' || !Number.isInteger(pr) || pr < 1 || typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    return respond(res, 400, { error: 'pr must be a number and sha a hex commit of 7 to 40 characters' });
  }
  const proof = await optionalProof(body, { action: 'release-approve', pr, sha }, opts, deps);
  if (proof.kind === 'refused') return respond(res, 403, { approved: false, reason: proof.reason, detail: proof.detail });
  // Above the approval, because the controller's authorisation precedes the
  // write it authorises; the receipt names the credential that proved the person.
  if (proof.kind === 'verified') recordActionReceipt(opts.repoRoot, 'release-approve', `${pr} passkey:${proof.credentialId}`);
  const ports = await mergePortsFor(opts, 'person');
  const result = await releaseApproveAt(ports, pr, sha, proof.kind === 'verified' ? { credentialId: proof.credentialId } : 'none');
  if (!result.approved) return respond(res, 409, result);
  (deps.finish ?? startFinish)(opts, result.pr);
  respond(res, 200, { ...result, credentialId: proof.kind === 'verified' ? proof.credentialId : undefined });
};
