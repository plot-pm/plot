import { z } from 'zod';
import { FindingNameSchema, MEASURED_BY, type FindingName } from '../../src/entities/finding.js';
import type { Admission } from '../../src/entities/subscription.js';

/**
 * `admit` as it stood at `2818a4b95^`, the commit before the snapshot purpose
 * existed (`git show 2818a4b95^:packages/domain/src/rules/channel.ts`), with
 * its two-purpose `PurposeSchema` inlined. A test passes it to `startChannel`
 * as the channel an older fleetd runs.
 *
 * Do not edit it to follow the current `admit`: the file is the older answer.
 */
const OldPurposeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everything') }),
  z.object({
    kind: z.literal('until'),
    finding: FindingNameSchema.exclude(['clear']),
    branch: z.string().default(''),
  }),
]);

const MEASURABLE = Object.keys(MEASURED_BY) as FindingName[];

const ALIASES: Readonly<Record<string, FindingName>> = {
  'ci is green': 'checks green',
  'ci is red': 'checks failing',
};

const Shape = z.object({ subscriber: z.string().default(''), purpose: OldPurposeSchema });

const describeAsked = (raw: unknown): string => {
  if (typeof raw !== 'object' || raw === null) return '';
  const purpose = (raw as { purpose?: unknown }).purpose;
  if (typeof purpose !== 'object' || purpose === null) return '';
  const finding = (purpose as { finding?: unknown }).finding;
  return typeof finding === 'string' ? finding : '';
};

export const admitBeforeSnapshot = (id: string, raw: unknown): Admission => {
  const asked = describeAsked(raw);
  const canonical: string = ALIASES[asked.toLowerCase()] ?? asked;
  if (asked !== '' && !MEASURABLE.includes(canonical as FindingName)) {
    return { ok: false, reason: `this channel does not measure '${asked}'`, asked, measurable: MEASURABLE };
  }
  const request = canonical === '' ? raw : { ...(raw as { purpose: object }), purpose: { ...(raw as { purpose: object }).purpose, finding: canonical } };
  const parsed = Shape.safeParse(request);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'a subscription must carry a purpose: either everything, or until <condition> holds',
      asked,
      measurable: MEASURABLE,
    };
  }
  return { ok: true, subscription: { id, subscriber: parsed.data.subscriber, purpose: parsed.data.purpose } };
};
