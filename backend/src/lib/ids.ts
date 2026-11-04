import { randomBytes } from 'node:crypto';

// Crockford base32 alphabet (no I, L, O, U) - unambiguous when read aloud or typed.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Returns an id like EVX-7K2M9QF3XA (50 bits of cryptographic randomness). */
export function newConfirmationId(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] & 31];
  return `EVX-${out}`;
}
