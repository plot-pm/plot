/** One declared App key as the start probe reads it. */
export type AppKeyReading =
  | { read: 'usable' }
  | { read: 'absent' }
  | { read: 'invalid'; reason: string }
  | { read: 'unread' };

/** The `## Plot Config` keys that name a GitHub App. */
export const APP_KEY_CONFIG_KEYS = ['Review app', 'Merger app', 'Writer app'] as const;

/** One key and what the probe read for it, or why the read threw. */
export interface AppKeyProbed {
  configKey: string;
  reading: AppKeyReading | { read: 'failed'; reason: string };
}

/**
 * The log lines the start probe writes: one per key that is missing or
 * unreadable. A `usable` key and an `absent` key (not declared) produce none.
 * A line carries the config key, the reading and the reason, which names the
 * key path the resolver tried; it never carries key contents.
 *
 * @param probed - one entry per key, in the order to log.
 * @returns the lines, without a trailing newline.
 */
export const appKeyStartLines = (probed: readonly AppKeyProbed[]): string[] =>
  probed.flatMap(({ configKey, reading }) => {
    switch (reading.read) {
      case 'usable':
      case 'absent':
        return [];
      case 'invalid':
        return [`App key '${configKey}' is not usable: ${reading.reason}`];
      case 'unread':
        return [`App key '${configKey}': the check did not answer, so the key is not known to be usable`];
      case 'failed':
        return [`App key '${configKey}': the start probe failed (${reading.reason})`];
    }
  });
