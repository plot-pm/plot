import {
  APP_KEY_CONFIG_KEYS,
  appKeyStartLines,
  type AppKeyProbed,
  type AppKeyReading,
} from '../rules/app-key-start-lines.js';

/**
 * Reads every declared App key once and writes one line per key that is
 * missing or unreadable. Holds nothing: a reader that throws is reported as a
 * failed probe for that key, and the caller goes on.
 *
 * @param read - reads one config key; may throw.
 * @param write - receives each line.
 * @returns the lines written.
 */
export const probeAppKeysAtStart = (
  read: (configKey: string) => AppKeyReading,
  write: (line: string) => void,
): string[] => {
  const probed: AppKeyProbed[] = APP_KEY_CONFIG_KEYS.map((configKey) => {
    try {
      return { configKey, reading: read(configKey) };
    } catch (error) {
      return { configKey, reading: { read: 'failed', reason: error instanceof Error ? error.message : String(error) } };
    }
  });
  const lines = appKeyStartLines(probed);
  for (const line of lines) write(line);
  return lines;
};
