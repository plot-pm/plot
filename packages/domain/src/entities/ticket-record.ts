import { z } from 'zod';

/**
 * The version word a ticket record carries.
 *
 * A literal, so a future format's file fails the parse and reads as
 * UNREADABLE, never as no ticket: reading an unknown record as absent opens a
 * second ticket for the same PR.
 */
export const TICKET_RECORD_VERSION = 1;

/**
 * One PR's ticket record, keyed by PR NUMBER and not by head.
 *
 * `pending` is written BEFORE the tracker is asked to open the issue; `opened`
 * replaces it once the tracker answers with an identifier. A `pending` record
 * is neither "no ticket" nor a confirmed one: the open call may be in flight
 * or may have landed with the write-back lost.
 *
 * `heads` lists every head SHA whose findings are on the ticket, as the first
 * body or a later comment.
 */
export const TicketRecordSchema = z.discriminatedUnion('ticket', [
  z
    .object({
      v: z.literal(TICKET_RECORD_VERSION),
      pr: z.number().int().positive(),
      ticket: z.literal('pending'),
      /** ISO-8601, this machine's clock. */
      at: z.string().min(1),
    })
    .strict(),
  z
    .object({
      v: z.literal(TICKET_RECORD_VERSION),
      pr: z.number().int().positive(),
      ticket: z.literal('opened'),
      /** The tracker's identifier for the issue, verbatim. */
      id: z.string().min(1),
      heads: z.array(z.string().min(1)),
    })
    .strict(),
]);
export type TicketRecord = z.infer<typeof TicketRecordSchema>;

/**
 * Parses a record file's text.
 *
 * @param text - the file's contents; `''` for a file that does not exist.
 * @returns `'none'` for empty text, `'unreadable'` for text that is not a
 *   record this version recognises, or the decoded record.
 */
export const decodeTicketRecord = (text: string): TicketRecord | 'none' | 'unreadable' => {
  if (text.trim() === '') return 'none';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  const result = TicketRecordSchema.safeParse(parsed);
  return result.success ? result.data : 'unreadable';
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodeTicketRecord = (record: TicketRecord): string => `${JSON.stringify(record, null, 2)}\n`;
