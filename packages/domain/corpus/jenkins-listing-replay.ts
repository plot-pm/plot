import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { jenkinsBuildReader, type CiBuildReader } from '../src/adapters/host/ci-overlay.js';
import { jenkinsApi, jenkinsReads } from '../src/adapters/build/jenkins-api.js';
import { budgetFile } from '../src/adapters/budget/budget-file.js';
import { slotsFile } from '../src/adapters/slots/slots-file.js';

/** What a Jenkins listing fixture records besides the host's exchanges. */
export interface JenkinsRecording {
  readonly instance: string;
  readonly routes: Record<string, { readonly body?: { builds?: unknown[] } & Record<string, unknown>; readonly failIf?: string }>;
  readonly calls: readonly { readonly argv: string[]; readonly stdout: string; readonly stderr: string; readonly code: number }[];
  readonly requests: readonly string[];
}

/** A stub Jenkins under `/jenkins` that keeps every request path it served. */
export interface JenkinsStub {
  readonly port: number;
  readonly seen: string[];
  close(): Promise<void>;
}

/** Serves a recording's routes on loopback, honouring the builds window; a path with no route answers 404. */
export const serveJenkins = async (routes: JenkinsRecording['routes']): Promise<JenkinsStub> => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    const url = req.url ?? '';
    seen.push(url);
    const route = routes[url.split('?')[0]?.replace(/^\/jenkins/, '') ?? ''];
    if (route === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html>not found</html>');
      return;
    }
    if (route.failIf !== undefined && url.includes(route.failIf)) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<html>boom</html>');
      return;
    }
    let text = JSON.stringify(route.body ?? {});
    const window = /%7B0,(\d+)%7D/.exec(url) ?? /\{0,(\d+)\}/.exec(url);
    if (route.body !== undefined && Array.isArray(route.body.builds) && window !== null) {
      text = JSON.stringify({ ...route.body, builds: route.body.builds.slice(0, Number(window[1])) });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/** The in-process reader over a stub, with its own ledger directory; `cleanup` removes it. */
export const stubReader = (recording: JenkinsRecording, port: number): { reader: CiBuildReader; cleanup: () => void } => {
  const home = mkdtempSync(join(tmpdir(), 'plot-jenkins-listing-'));
  const env = {
    JEN_URL: `http://127.0.0.1:${String(port)}/jenkins`,
    JEN_CONFIG_DIR: home,
    HOME: home,
    JEN_TOKEN: 'fixture-bearer',
    JENKINS_USER: 'fixture',
    JENKINS_API_TOKEN: 'fixture-api-token',
    JEN_REALM_URL: 'https://id.example.org/realms/r',
  };
  const api = jenkinsApi({ instance: recording.instance.split('/')[0] ?? '', env, budget: budgetFile({ home }), slots: slotsFile({ home, isAlive: () => true }), now: Date.now, pollMs: 20, tornReadMs: 20 });
  const reader = jenkinsBuildReader({
    reads: jenkinsReads(api),
    config: async (key) => (key === 'Jenkins instance' ? recording.instance : ''),
    defaultBranch: async () => '',
    env: { JENKINS_INSTANCE: recording.instance },
  });
  return { reader, cleanup: () => rmSync(home, { recursive: true, force: true }) };
};

/** A stub `jen` that replays the recorded output for the recorded argv, and fails on any other argv. */
export const stubJenReplay = (dir: string, recording: JenkinsRecording): void => {
  mkdirSync(dir, { recursive: true });
  recording.calls.forEach((call, i) => {
    writeFileSync(join(dir, `call-${String(i)}.argv`), `${call.argv.join('\n')}\n`);
    writeFileSync(join(dir, `call-${String(i)}.out`), call.stdout);
    writeFileSync(join(dir, `call-${String(i)}.err`), call.stderr);
    writeFileSync(join(dir, `call-${String(i)}.code`), String(call.code));
  });
  writeFileSync(
    join(dir, 'jen'),
    [
      '#!/usr/bin/env bash',
      `dir=${JSON.stringify(dir)}`,
      'printf \'%s\\n\' "$@" > "$dir/asked"',
      'for f in "$dir"/call-*.argv; do',
      '  if cmp -s "$f" "$dir/asked"; then b="${f%.argv}"; cat "$b.out"; cat "$b.err" >&2; exit "$(cat "$b.code")"; fi',
      'done',
      'echo "stub jen: unrecorded argv: $*" >&2',
      'exit 1',
      '',
    ].join('\n'),
  );
  chmodSync(join(dir, 'jen'), 0o755);
};
