import { describe, expect, it } from 'vitest';
import { validateConfirmationId, validateEventId, validateRegistration } from '../src/lib/validation.js';
import { newConfirmationId } from '../src/lib/ids.js';
import { HttpError } from '../src/lib/http.js';

describe('validateRegistration', () => {
  it('normalizes and accepts valid input', () => {
    expect(validateRegistration({ name: '  Ada   Lovelace ', email: ' Ada@Example.COM ', organization: 'GovTech' })).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      organization: 'GovTech',
    });
  });

  it('rejects missing and malformed fields with per-field details', () => {
    try {
      validateRegistration({ name: 'A', email: 'not-an-email', organization: '' });
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      const err = e as HttpError;
      expect(err.statusCode).toBe(400);
      expect(Object.keys(err.details ?? {}).sort()).toEqual(['email', 'name', 'organization']);
    }
  });

  it('rejects HTML injection attempts and non-objects', () => {
    expect(() => validateRegistration({ name: '<script>', email: 'a@b.co', organization: 'Org' })).toThrow(HttpError);
    expect(() => validateRegistration([])).toThrow(HttpError);
    expect(() => validateRegistration(null)).toThrow(HttpError);
  });
});

describe('ids', () => {
  it('generates valid, unique confirmation ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newConfirmationId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(validateConfirmationId(id)).toBe(id);
  });

  it('validates event ids', () => {
    expect(validateEventId('govtech-stack-x-2026')).toBe('govtech-stack-x-2026');
    expect(() => validateEventId('../etc')).toThrow(HttpError);
    expect(() => validateEventId(undefined)).toThrow(HttpError);
  });
});
