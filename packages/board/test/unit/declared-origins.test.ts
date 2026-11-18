// The same-origin check and the origins `PLOT_BOARD_ORIGINS` adds to it, as values.
import type http from 'node:http';
import { describe, it, expect } from 'vitest';
import { ORIGINS_ENV, declaredOrigins, isSameOrigin } from '../../src/server/dispatch.js';

const PORT = 7777;
const TAILNET = 'https://zio.example.ts.net';

const request = (headers: Record<string, string>): http.IncomingMessage =>
  ({ headers }) as unknown as http.IncomingMessage;

const fromPage = (origin: string): http.IncomingMessage =>
  request({ origin, 'sec-fetch-site': 'same-origin' });

describe('declaredOrigins', () => {
  it('reads nothing where the variable is absent', () => {
    expect(declaredOrigins({})).toEqual([]);
  });

  it('reads each exact origin in a comma-separated list', () => {
    expect(declaredOrigins({ [ORIGINS_ENV]: `${TAILNET}, ${TAILNET}:7777` })).toEqual([
      TAILNET,
      `${TAILNET}:7777`,
    ]);
  });

  for (const entry of [`${TAILNET}/`, `${TAILNET}/board`, 'zio.example.ts.net', 'not a url', '*']) {
    it(`drops ${JSON.stringify(entry)}, which is not an exact origin`, () => {
      expect(declaredOrigins({ [ORIGINS_ENV]: entry })).toEqual([]);
    });
  }
});

describe('isSameOrigin', () => {
  for (const origin of [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, `http://[::1]:${PORT}`]) {
    it(`admits the loopback origin ${origin}`, () => {
      expect(isSameOrigin(fromPage(origin), PORT, {})).toBe(true);
    });
  }

  it('refuses an undeclared tailnet origin', () => {
    expect(isSameOrigin(fromPage(TAILNET), PORT, {})).toBe(false);
  });

  it('admits a tailnet origin that PLOT_BOARD_ORIGINS declares', () => {
    expect(isSameOrigin(fromPage(TAILNET), PORT, { [ORIGINS_ENV]: TAILNET })).toBe(true);
  });

  it('refuses a declared origin on another port', () => {
    expect(isSameOrigin(fromPage(`${TAILNET}:8443`), PORT, { [ORIGINS_ENV]: TAILNET })).toBe(false);
  });

  it('refuses a cross-site request even from a declared origin', () => {
    const req = request({ origin: TAILNET, 'sec-fetch-site': 'cross-site' });
    expect(isSameOrigin(req, PORT, { [ORIGINS_ENV]: TAILNET })).toBe(false);
  });

  it('admits a caller that sends neither header', () => {
    expect(isSameOrigin(request({}), PORT, {})).toBe(true);
  });
});
