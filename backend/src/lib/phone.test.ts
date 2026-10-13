import { describe, it, expect } from 'vitest';
import { isPakistaniMobile, phoneDigits, samePhone } from './phone';

describe('phoneDigits (SRS Part 0.3: digits only, everywhere)', () => {
  it('strips +, spaces and dashes', () => {
    expect(phoneDigits('+92 300 123-4567')).toBe('923001234567');
  });
  it('turns a local 0300… number into 92300…', () => {
    expect(phoneDigits('0300 1234567')).toBe('923001234567');
  });
  it('drops an international 00 prefix', () => {
    expect(phoneDigits('0092 300 1234567')).toBe('923001234567');
  });
  it('leaves a wa_id alone', () => {
    expect(phoneDigits('923001234567')).toBe('923001234567');
  });
  it('is null for nothing or a non-string', () => {
    expect(phoneDigits('')).toBeNull();
    expect(phoneDigits('  -  ')).toBeNull();
    expect(phoneDigits(null)).toBeNull();
    expect(phoneDigits(923001234567)).toBeNull();
  });
});

describe('isPakistaniMobile', () => {
  it('accepts 92 + 3 + nine digits only', () => {
    expect(isPakistaniMobile('923001234567')).toBe(true);
    expect(isPakistaniMobile('92300123456')).toBe(false); // too short
    expect(isPakistaniMobile('924212345678')).toBe(false); // a landline code
    expect(isPakistaniMobile('13001234567')).toBe(false); // not Pakistan
    expect(isPakistaniMobile(null)).toBe(false);
  });
});

describe('samePhone (the P2 test-order check)', () => {
  it('matches a typed +92 number against the wa_id WhatsApp sends', () => {
    expect(samePhone('+92 300 1234567', '923001234567')).toBe(true);
    expect(samePhone('03001234567', '923001234567')).toBe(true);
  });
  it('does not match different numbers, or nothing', () => {
    expect(samePhone('+92 300 1234567', '923001234568')).toBe(false);
    expect(samePhone(null, '923001234567')).toBe(false);
  });
});
