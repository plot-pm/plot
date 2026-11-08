import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionSchema, CardFactsSchema } from '../src/entities/card-facts.js';

/**
 * The string fields `CardFacts` may hold: identifiers, ISO dates and content
 * copied verbatim from the item. Any other string field is a word the domain
 * generated, and the gate refuses it.
 */
const ALLOWED_STRING_FIELDS = new Set(['id', 'key', 'release', 'slug', 'branch', 'plan', 'assignees', 'path', 'at', 'title', 'summary', 'value']);

/** Every free-string leaf of a schema, as the dotted path of field names that reaches it. */
const stringFields = (schema: z.ZodType, at: string[] = []): string[] => {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def;
  switch (def.type) {
    case 'string':
      return [at.join('.')];
    case 'object': {
      const shape = def.shape as Record<string, z.ZodType>;
      // A `Known` value wrapper names nothing of its own: its strings belong to the field around it.
      if (Object.keys(shape).length === 1 && 'value' in shape) return stringFields(shape.value, at);
      return Object.entries(shape).flatMap(([k, v]) => stringFields(v, [...at, k]));
    }
    case 'union':
      return (def.options as z.ZodType[]).flatMap((o) => stringFields(o, at));
    case 'array':
      return stringFields(def.element as z.ZodType, [...at, '[]']);
    case 'nullable':
    case 'optional':
    case 'default':
    case 'readonly':
      return stringFields(def.innerType as z.ZodType, at);
    case 'pipe':
      return stringFields(def.in as z.ZodType, at);
    default:
      return [];
  }
};

/** The fields among `schema`'s string leaves whose own name is not on the allow-list. */
const refused = (schema: z.ZodType): string[] =>
  [...new Set(stringFields(schema))].filter((p) => !ALLOWED_STRING_FIELDS.has(p.split('.').filter((s) => s !== '[]').pop() ?? ''));

describe('the CardFacts schema gate', () => {
  it('finds a string leaf in every facet it walks', () => {
    const found = stringFields(CardFactsSchema);
    expect(found).toContain('identity.title');
    expect(found).toContain('lineage.stories.[].slug');
    expect(found).toContain('ownership.since.at');
    expect(found).toContain('ownership.assignees.[]');
  });

  it('holds no free-text string field beyond ids, dates and verbatim content', () => {
    expect(refused(CardFactsSchema)).toEqual([]);
  });

  it('refuses a seeded free-text field', () => {
    const seeded = CardFactsSchema.extend({
      next: z.object({ primary: ActionSchema.nullable(), secondary: z.array(ActionSchema), label: z.string() }),
    });
    expect(refused(seeded)).toEqual(['next.label']);
  });

  it('refuses a seeded word carried inside a Known list', () => {
    const seeded = z.object({ labels: z.union([z.object({ value: z.array(z.string()) }), z.object({ unknown: z.string() })]) });
    expect(refused(seeded)).toEqual(['labels.[]', 'labels.unknown']);
  });

  it('refuses a seeded word nested inside a union', () => {
    const seeded = z.object({ reason: z.union([z.object({ kind: z.literal('x'), sentence: z.string() }), z.object({ kind: z.literal('y') })]) });
    expect(refused(seeded)).toEqual(['reason.sentence']);
  });
});

describe('Action', () => {
  it('refuses an enabled action that carries a reason', () => {
    expect(ActionSchema.safeParse({ action: 'approve', enabled: true, reason: { kind: 'awaiting-fleet-scan' } }).success).toBe(false);
  });

  it('refuses a disabled action with no reason', () => {
    expect(ActionSchema.safeParse({ action: 'approve', enabled: false, reason: null }).success).toBe(false);
  });

  it('accepts each half of the invariant', () => {
    expect(ActionSchema.safeParse({ action: 'approve', enabled: true, reason: null }).success).toBe(true);
    expect(ActionSchema.safeParse({ action: 'start-work', enabled: false, reason: { kind: 'awaiting-fleet-scan' } }).success).toBe(true);
  });
});
