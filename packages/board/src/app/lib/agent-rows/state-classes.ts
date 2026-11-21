import type { HeaderTone, SliceState } from '@plot-pm/domain';

/** The class that colours each slice state in a bar, a legend swatch or a strip block. */
export const SEGMENT_CLASS: Readonly<Record<SliceState, string>> = {
  delivered: 'delivery-state-delivered',
  'at-a-gate': 'delivery-state-at-a-gate',
  'being-built': 'delivery-state-being-built',
  blocked: 'delivery-state-blocked',
  'not-started': 'delivery-state-not-started',
};

/** The class that colours each tone of a Delivery header number, clause or meter. */
export const TONE_CLASS: Readonly<Record<HeaderTone, string>> = {
  red: 'delivery-hue-red',
  amber: 'delivery-hue-amber',
  grey: 'delivery-text-muted',
  green: 'delivery-hue-green',
  plain: 'text-(--card-body)',
};
