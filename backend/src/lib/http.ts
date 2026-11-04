import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

const baseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: baseHeaders, body: JSON.stringify(body) };
}

export function errorResponse(err: unknown, requestId?: string): APIGatewayProxyStructuredResultV2 {
  if (err instanceof HttpError) {
    return json(err.statusCode, { error: { code: err.code, message: err.message, details: err.details } });
  }
  // Never log request bodies or attendee data - only the error type/message and request id.
  log('error', 'Unhandled error', {
    requestId,
    errorName: err instanceof Error ? err.name : 'Unknown',
    errorMessage: err instanceof Error ? err.message : String(err),
  });
  return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}

/** Structured JSON logger. Callers must never pass personal data (name, email, organization). */
export function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function parseJsonBody(body: string | undefined, isBase64Encoded?: boolean): unknown {
  if (!body) throw new HttpError(400, 'INVALID_BODY', 'Request body is required.');
  if (body.length > 10_000) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  const raw = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }
}
