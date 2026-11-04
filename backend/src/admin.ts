import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { errorResponse, HttpError, json, log } from './lib/http.js';
import { cancelRegistration, getEvent, listEvents, listRegistrations } from './lib/repo.js';
import { validateConfirmationId, validateEventId } from './lib/validation.js';

export const ORGANIZER_GROUP = process.env.ORGANIZER_GROUP ?? 'organizers';

/** HTTP API passes cognito:groups as either an array or a string like "[organizers admins]". */
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String);
  if (typeof claim !== 'string' || !claim) return [];
  return claim
    .replace(/^\[|\]$/g, '')
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export function assertOrganizer(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required.');
  if (!parseGroups(claims['cognito:groups']).includes(ORGANIZER_GROUP)) {
    throw new HttpError(403, 'FORBIDDEN', 'Organizer access required.');
  }
  return String(claims.sub);
}

/** Organizer API - JWT-authorized at API Gateway, group-authorized here. */
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext?.requestId;
  try {
    const organizerSub = assertOrganizer(event);
    switch (event.routeKey) {
      case 'GET /admin/events':
        return json(200, { events: await listEvents() });
      case 'GET /admin/events/{eventId}/registrations': {
        const eventId = validateEventId(event.pathParameters?.eventId);
        const [ev, registrations] = await Promise.all([getEvent(eventId), listRegistrations(eventId)]);
        return json(200, { event: ev, registrations });
      }
      case 'DELETE /admin/events/{eventId}/registrations/{confirmationId}': {
        const eventId = validateEventId(event.pathParameters?.eventId);
        const confirmationId = validateConfirmationId(event.pathParameters?.confirmationId);
        await cancelRegistration(eventId, confirmationId);
        log('info', 'Registration cancelled', { requestId, eventId, confirmationId, organizerSub });
        return json(200, { confirmationId, status: 'CANCELLED', event: await getEvent(eventId) });
      }
      default:
        throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    }
  } catch (err) {
    if (err instanceof HttpError) log('warn', 'Request rejected', { requestId, route: event.routeKey, code: err.code });
    return errorResponse(err, requestId);
  }
}
