import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { errorResponse, HttpError, json, log, parseJsonBody } from './lib/http.js';
import { getEvent, listEvents, registerAttendee } from './lib/repo.js';
import { validateEventId, validateRegistration } from './lib/validation.js';

/** Public API: event details, aggregate counts and self-registration. Never returns attendee PII. */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext?.requestId;
  try {
    switch (event.routeKey) {
      case 'GET /events':
        return json(200, { events: await listEvents() });
      case 'GET /events/{eventId}':
        return json(200, { event: await getEvent(validateEventId(event.pathParameters?.eventId)) });
      case 'POST /events/{eventId}/registrations': {
        const eventId = validateEventId(event.pathParameters?.eventId);
        const input = validateRegistration(parseJsonBody(event.body, event.isBase64Encoded));
        const result = await registerAttendee(eventId, input);
        log('info', 'Registration created', { requestId, eventId, confirmationId: result.confirmationId });
        const updated = await getEvent(eventId);
        return json(201, {
          confirmationId: result.confirmationId,
          registeredAt: result.createdAt,
          event: { eventId, name: updated.name, availableSeats: updated.availableSeats },
        });
      }
      default:
        throw new HttpError(404, 'NOT_FOUND', 'Route not found.');
    }
  } catch (err) {
    if (err instanceof HttpError) log('warn', 'Request rejected', { requestId, route: event.routeKey, code: err.code });
    return errorResponse(err, requestId);
  }
}
