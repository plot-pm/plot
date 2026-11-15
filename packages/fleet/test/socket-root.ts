/**
 * The directory a test makes its temp root in when it binds a unix socket there.
 *
 * A unix socket path holds at most 104 bytes on macOS. Under
 * `scripts/owned-run.sh`, `os.tmpdir()` alone is 65 bytes deep on macOS, so
 * `<mkdtemp>/.plot/fleet.sock` passes the limit and `listen` fails `EINVAL`.
 * `/tmp` keeps the same socket path near 50 bytes. A test removes what it makes
 * here by the exact name `mkdtempSync` returned, as it does under `tmpdir()`.
 */
export const SOCKET_TEMP_ROOT = '/tmp';
