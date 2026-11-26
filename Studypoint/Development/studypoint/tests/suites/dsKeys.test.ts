// Keyboard/value logic behind the design-system components (DESIGN §5, APG patterns).

import { fractionFromValue, nextIndex, sliderKeyValue, snapValue, typeaheadIndex, valueFromFraction } from '../../src/client/ds/keys.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('ds/nextIndex: vertical arrows move and wrap; horizontal ignores up/down', () => {
    assert.equal(nextIndex('ArrowDown', 0, 3), 1);
    assert.equal(nextIndex('ArrowDown', 2, 3), 0);
    assert.equal(nextIndex('ArrowUp', 0, 3), 2);
    assert.equal(nextIndex('ArrowDown', 0, 3, { orientation: 'horizontal' }), null);
    assert.equal(nextIndex('ArrowRight', 0, 3, { orientation: 'horizontal' }), 1);
  });

  test('ds/nextIndex: no-loop stops at the ends', () => {
    assert.equal(nextIndex('ArrowDown', 2, 3, { loop: false }), 2);
    assert.equal(nextIndex('ArrowUp', 0, 3, { loop: false }), 0);
  });

  test('ds/nextIndex: disabled items are skipped, Home/End land on enabled items', () => {
    const disabled = [true, false, true, false, true];
    assert.equal(nextIndex('ArrowDown', 1, 5, { disabled }), 3);
    assert.equal(nextIndex('ArrowDown', 3, 5, { disabled }), 1);
    assert.equal(nextIndex('Home', 3, 5, { disabled }), 1);
    assert.equal(nextIndex('End', 1, 5, { disabled }), 3);
    assert.equal(nextIndex('ArrowDown', 0, 3, { disabled: [true, true, true] }), null);
  });

  test('ds/nextIndex: with nothing active, down goes to first, up to last', () => {
    assert.equal(nextIndex('ArrowDown', -1, 4), 0);
    assert.equal(nextIndex('ArrowUp', -1, 4), 3);
    assert.equal(nextIndex('Enter', 0, 4), null);
  });

  test('ds/nextIndex: PageDown/PageUp jump by a page and clamp', () => {
    assert.equal(nextIndex('PageDown', 0, 30, { pageSize: 10 }), 10);
    assert.equal(nextIndex('PageDown', 25, 30, { pageSize: 10 }), 29);
    assert.equal(nextIndex('PageUp', 25, 30, { pageSize: 10 }), 15);
  });

  test('ds/typeahead: jumps by prefix, cycles on repeated letters, skips disabled', () => {
    const labels = ['Light', 'Dark', 'System', 'Sepia'];
    assert.equal(typeaheadIndex('d', labels, 0), 1);
    assert.equal(typeaheadIndex('s', labels, 0), 2);
    assert.equal(typeaheadIndex('ss', labels, 2), 3, 'repeat cycles to the next S');
    assert.equal(typeaheadIndex('se', labels, 0), 3);
    assert.equal(typeaheadIndex('sy', labels, 0, [false, false, true, false]), null);
    assert.equal(typeaheadIndex('x', labels, 0), null);
  });

  test('ds/slider: snapping clamps and avoids float noise', () => {
    assert.equal(snapValue(0.1 + 0.2, 0, 1, 0.1), 0.3);
    assert.equal(snapValue(0.913, 0.7, 0.97, 0.01), 0.91);
    assert.equal(snapValue(999, 5, 600, 5), 600);
    assert.equal(snapValue(-3, 5, 600, 5), 5);
    assert.equal(snapValue(22, 5, 600, 5), 20);
  });

  test('ds/slider: keys follow APG (arrows, PageUp/Down, Home/End)', () => {
    const o = { min: 5, max: 600, step: 5, bigStep: 30 };
    assert.equal(sliderKeyValue('ArrowRight', 20, o), 25);
    assert.equal(sliderKeyValue('ArrowDown', 20, o), 15);
    assert.equal(sliderKeyValue('PageUp', 20, o), 50);
    assert.equal(sliderKeyValue('Home', 20, o), 5);
    assert.equal(sliderKeyValue('End', 20, o), 600);
    assert.equal(sliderKeyValue('a', 20, o), null);
  });

  test('ds/slider: pointer fraction maps to snapped values and back', () => {
    assert.equal(valueFromFraction(0.5, 0, 100, 10), 50);
    assert.equal(valueFromFraction(1.4, 0, 100, 10), 100);
    assert.equal(fractionFromValue(25, 0, 100), 0.25);
    assert.equal(fractionFromValue(5, 5, 5), 0);
  });
}
