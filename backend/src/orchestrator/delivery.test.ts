import { describe, it, expect } from 'vitest';
import { matchZone } from './delivery';

const zone = (area_name: string, charge = 20000, is_serviceable = true) => ({ area_name, charge, is_serviceable });
const zones = [zone('DHA'), zone('DHA Phase 5', 15000), zone('Gulberg III'), zone('Raiwind', 0, false), zone('Model Town')];

describe('matchZone', () => {
  it('finds the zone named inside the typed area, most specific first', () => {
    expect(matchZone('House 4, DHA Phase 5, Lahore', zones)?.area_name).toBe('DHA Phase 5');
    expect(matchZone('dha phase 2', zones)?.area_name).toBe('DHA');
    expect(matchZone('model town', zones)?.area_name).toBe('Model Town');
  });
  it('finds a zone that contains a shorter typed area', () => {
    expect(matchZone('Gulberg', zones)?.area_name).toBe('Gulberg III');
  });
  it('returns non-serviceable zones too, so the caller can refuse delivery', () => {
    expect(matchZone('Raiwind Road', zones)?.is_serviceable).toBe(false);
  });
  it('treats the customer text as plain words, never a pattern', () => {
    expect(matchZone('%', zones)).toBeNull();
    expect(matchZone('_ _ _', zones)).toBeNull();
    expect(matchZone('Johar Town', zones)).toBeNull(); // "Town" alone is not a zone
    expect(matchZone('Dhaka', zones)).toBeNull(); // whole words only, not "DHA" inside "Dhaka"
  });
});
