import { describe, expect, it } from 'vitest';
import { referenceSearchVariant } from './reference';

describe('referenceSearchVariant', () => {
  it('prioritizes female or immature wording over generic male mentions', () => {
    expect(
      referenceSearchVariant('Rose-breasted Grosbeak', [
        'This appears to be a female or immature Rose-breasted Grosbeak; adult males have a striking black-and-white pattern.',
      ]),
    ).toEqual({
      label: 'female or immature',
      queries: [
        'female Rose-breasted Grosbeak',
        'immature Rose-breasted Grosbeak',
        'juvenile Rose-breasted Grosbeak',
      ],
    });
  });

  it('detects male-only visual hints', () => {
    expect(referenceSearchVariant('Northern Cardinal', ['Adult males are bright red.'])).toEqual({
      label: 'male',
      queries: ['male Northern Cardinal'],
    });
  });

  it('does not add a variant when facts have no visual sex or age cue', () => {
    expect(referenceSearchVariant('Blue Jay', ['They cache acorns and seeds.'])).toBeNull();
  });
});
