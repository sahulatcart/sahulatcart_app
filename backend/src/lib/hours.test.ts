import { describe, it, expect } from 'vitest';
import { dayInKarachi, formatHours, startOfTodayKarachi, todayHoursText, validBusinessHours } from './hours';

const week = { mon: { open: '10:00', close: '22:00' }, tue: { open: '10:00', close: '22:00' }, wed: { open: '10:00', close: '22:00' }, thu: { open: '10:00', close: '22:00' }, fri: { closed: true as const }, sat: { open: '11:00', close: '18:00' } };

describe('validBusinessHours', () => {
  it('accepts open/close days and closed days, nothing else', () => {
    expect(validBusinessHours(week)).toBe(true);
    expect(validBusinessHours({})).toBe(true);
    expect(validBusinessHours({ mon: { open: '10:00' } })).toBe(false);
    expect(validBusinessHours({ mon: { open: '25:00', close: '22:00' } })).toBe(false);
    expect(validBusinessHours({ monday: { open: '10:00', close: '22:00' } })).toBe(false);
    expect(validBusinessHours({ mon: { closed: false } })).toBe(false);
    expect(validBusinessHours([])).toBe(false);
    expect(validBusinessHours(null)).toBe(false);
  });
});

describe('startOfTodayKarachi (P5, FR-P5.6)', () => {
  it('23:30 PKT is still today; 00:30 PKT is already tomorrow, though both are the same UTC day', () => {
    expect(startOfTodayKarachi(new Date('2026-10-13T18:30:00Z'))).toBe('2026-10-12T19:00:00.000Z'); // 23:30 PKT on the 13th
    expect(startOfTodayKarachi(new Date('2026-10-13T19:30:00Z'))).toBe('2026-10-13T19:00:00.000Z'); // 00:30 PKT on the 14th
  });
});

describe('dayInKarachi', () => {
  it('uses Pakistan time, not UTC: 20:30 UTC on a Monday is already Tuesday in Karachi', () => {
    expect(dayInKarachi(new Date('2026-10-12T20:30:00Z'))).toBe('tue'); // 2026-10-12 is a Monday
    expect(dayInKarachi(new Date('2026-10-12T12:00:00Z'))).toBe('mon');
  });
});

describe('todayHoursText (the greeting line, FR-P2.5)', () => {
  it('states today\'s hours in Roman Urdu', () => {
    expect(todayHoursText(week, new Date('2026-10-12T12:00:00Z'))).toBe('Hum aaj 10:00–22:00 khule hain.');
  });
  it('says nothing on a closed or unset day, or with no hours at all', () => {
    expect(todayHoursText(week, new Date('2026-10-16T12:00:00Z'))).toBeNull(); // Friday: closed
    expect(todayHoursText(week, new Date('2026-10-18T12:00:00Z'))).toBeNull(); // Sunday: unset
    expect(todayHoursText({}, new Date())).toBeNull();
    expect(todayHoursText(undefined, new Date())).toBeNull();
  });
});

describe('formatHours (the WhatsApp profile line)', () => {
  it('folds consecutive days with the same times', () => {
    expect(formatHours(week)).toBe('Mon–Thu 10:00–22:00, Sat 11:00–18:00');
  });
  it('is null with nothing open', () => {
    expect(formatHours({ fri: { closed: true } })).toBeNull();
    expect(formatHours('10 to 10')).toBeNull();
  });
});
