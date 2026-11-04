import { HttpError } from './http.js';

export interface RegistrationInput {
  name: string;
  email: string;
  organization: string;
}

const EVENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const CONFIRMATION_ID_RE = /^EVX-[0-9A-HJKMNP-TV-Z]{10}$/;
// Pragmatic email check (RFC 5322 is not practical to validate with a regex).
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS_RE, '').replace(/\s+/g, ' ').trim();
}

export function validateEventId(value: string | undefined): string {
  if (!value || !EVENT_ID_RE.test(value)) throw new HttpError(400, 'INVALID_EVENT_ID', 'Invalid event id.');
  return value;
}

export function validateConfirmationId(value: string | undefined): string {
  if (!value || !CONFIRMATION_ID_RE.test(value)) {
    throw new HttpError(400, 'INVALID_CONFIRMATION_ID', 'Invalid confirmation id.');
  }
  return value;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateRegistration(body: unknown): RegistrationInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  const input = body as Record<string, unknown>;
  const name = cleanText(input.name);
  const email = cleanText(input.email);
  const organization = cleanText(input.organization);
  const details: Record<string, string> = {};

  if (name.length < 2) details.name = 'Name must be at least 2 characters.';
  else if (name.length > 100) details.name = 'Name must be at most 100 characters.';
  else if (/[<>]/.test(name)) details.name = 'Name contains invalid characters.';

  if (!email) details.email = 'Email is required.';
  else if (email.length > 254 || !EMAIL_RE.test(email)) details.email = 'Enter a valid email address.';

  if (organization.length < 2) details.organization = 'Organization must be at least 2 characters.';
  else if (organization.length > 150) details.organization = 'Organization must be at most 150 characters.';
  else if (/[<>]/.test(organization)) details.organization = 'Organization contains invalid characters.';

  if (Object.keys(details).length > 0) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Please correct the highlighted fields.', details);
  }
  return { name, email: normalizeEmail(email), organization };
}
