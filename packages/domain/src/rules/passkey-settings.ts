/** The server's `GET /api/passkey` answer. */
export interface PasskeyRegistration {
  registered: boolean;
  credentialId?: string;
  registeredAt?: string;
}

/** What the settings view and the header gear show about passkey registration. */
export interface PasskeySettings {
  /** The registration line; empty while the page is not on the registration host. */
  line: string;
  /** The label of the one action, or `null` while no action is offered. */
  action: 'Register' | 'Replace' | null;
  /** The shortened credential id, or `null` where none is shown. */
  credential: string | null;
  /** Whether the gear carries its marker. */
  marker: boolean;
  /** The notice shown in place of the controls, or `null` on the registration host. */
  notice: string | null;
}

/** The host the relying party id `localhost` accepts. */
export const PASSKEY_SETTINGS_HOST = 'localhost';

const SHORT_ID = 12;

/**
 * Decides what the settings view shows about passkey registration.
 *
 * @param held - the server's answer, or `null` while the read has not finished or has failed.
 * @param hostname - `location.hostname`.
 * @returns the registration line, the action label, the shortened credential id, the gear marker and the notice.
 * A hostname other than `localhost` answers the notice, no action and no marker. `null` answers a pending line,
 * no action and no marker, because an unread answer is not an unregistered one. Only `registered: false` sets the marker.
 * A credential id longer than 12 characters is cut to its first 12 followed by `…`.
 * `registeredAt` is shown in the reader's local time; a value that does not parse is shown as given.
 */
export const passkeySettings = (held: PasskeyRegistration | null, hostname: string): PasskeySettings => {
  if (hostname !== PASSKEY_SETTINGS_HOST) {
    return {
      line: '',
      action: null,
      credential: null,
      marker: false,
      notice: `A passkey works only on http://localhost:<port>. This page is on ${hostname}; open the board at localhost to register or approve.`,
    };
  }
  if (held === null) {
    return { line: 'Reading the registered passkey…', action: null, credential: null, marker: false, notice: null };
  }
  if (!held.registered) {
    return { line: 'No passkey registered', action: 'Register', credential: null, marker: true, notice: null };
  }
  const id = held.credentialId ?? '';
  const at = held.registeredAt ? new Date(held.registeredAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleString() : (held.registeredAt ?? 'an unknown time');
  return {
    line: `Passkey registered on ${when}`,
    action: 'Replace',
    credential: id.length > SHORT_ID ? `${id.slice(0, SHORT_ID)}…` : id,
    marker: false,
    notice: null,
  };
};
