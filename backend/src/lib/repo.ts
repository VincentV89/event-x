import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { HttpError } from './http.js';
import { newConfirmationId } from './ids.js';
import type { RegistrationInput } from './validation.js';

/*
 * Single-table design
 *  PK = EVENT#<eventId>  SK = META                 -> event details + registeredCount (+ GSI1 for listing events)
 *  PK = EVENT#<eventId>  SK = REG#<confirmationId> -> a registration (PII lives only here)
 *  PK = EVENT#<eventId>  SK = EMAIL#<email>        -> uniqueness guard for email per event
 */

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error('TABLE_NAME is not configured');
  return t;
}

export interface EventSummary {
  eventId: string;
  name: string;
  tagline?: string;
  description: string;
  startDate: string;
  endDate: string;
  venue: string;
  city?: string;
  capacity: number;
  registeredCount: number;
  availableSeats: number;
  capacityPercent: number;
  highlights?: string[];
}

export interface Registration {
  confirmationId: string;
  eventId: string;
  name: string;
  email: string;
  organization: string;
  status: 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  cancelledAt?: string;
}

const eventPk = (eventId: string) => `EVENT#${eventId}`;

export function toEventSummary(item: Record<string, unknown>): EventSummary {
  const capacity = Number(item.capacity ?? 0);
  const registeredCount = Number(item.registeredCount ?? 0);
  return {
    eventId: String(item.eventId),
    name: String(item.name),
    tagline: item.tagline as string | undefined,
    description: String(item.description ?? ''),
    startDate: String(item.startDate),
    endDate: String(item.endDate),
    venue: String(item.venue),
    city: item.city as string | undefined,
    capacity,
    registeredCount,
    availableSeats: Math.max(0, capacity - registeredCount),
    capacityPercent: capacity > 0 ? Math.round((registeredCount / capacity) * 1000) / 10 : 0,
    highlights: item.highlights as string[] | undefined,
  };
}

export async function listEvents(): Promise<EventSummary[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'EVENT' },
    }),
  );
  return (res.Items ?? []).filter((i) => !i.hidden).map(toEventSummary);
}

export async function getEvent(eventId: string): Promise<EventSummary> {
  const res = await ddb.send(new GetCommand({ TableName: tableName(), Key: { PK: eventPk(eventId), SK: 'META' } }));
  if (!res.Item) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found.');
  return toEventSummary(res.Item);
}

/**
 * Atomically registers an attendee. One DynamoDB transaction:
 *  1. increments registeredCount only if registeredCount < capacity (capacity-safe under concurrency)
 *  2. creates the EMAIL# guard only if it does not exist (duplicate-safe under concurrency)
 *  3. creates the REG# item only if the confirmation id is unused
 * Either all three succeed or none do.
 */
export async function registerAttendee(
  eventId: string,
  input: RegistrationInput,
  now = new Date(),
): Promise<{ confirmationId: string; createdAt: string }> {
  const confirmationId = newConfirmationId();
  const createdAt = now.toISOString();
  const pk = eventPk(eventId);
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: { PK: pk, SK: 'META' },
              UpdateExpression: 'SET registeredCount = registeredCount + :one, updatedAt = :now',
              ConditionExpression: 'attribute_exists(PK) AND registeredCount < capacity AND registrationOpen = :true',
              ExpressionAttributeValues: { ':one': 1, ':now': createdAt, ':true': true },
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: { PK: pk, SK: `EMAIL#${input.email}`, confirmationId, createdAt },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                PK: pk,
                SK: `REG#${confirmationId}`,
                entityType: 'REGISTRATION',
                confirmationId,
                eventId,
                name: input.name,
                email: input.email,
                organization: input.organization,
                status: 'CONFIRMED',
                createdAt,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons ?? [];
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        throw new HttpError(409, 'ALREADY_REGISTERED', 'This email address is already registered for this event.');
      }
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        const event = await getEvent(eventId); // 404 if the event does not exist
        if (event.availableSeats <= 0) {
          throw new HttpError(409, 'EVENT_FULL', 'Sorry, this event has reached full capacity.');
        }
        throw new HttpError(409, 'REGISTRATION_CLOSED', 'Registration for this event is closed.');
      }
      if (reasons.some((r) => r.Code === 'TransactionConflict')) {
        throw new HttpError(503, 'BUSY', 'High demand right now - please try again in a moment.');
      }
    }
    throw err;
  }
  return { confirmationId, createdAt };
}

export async function listRegistrations(eventId: string): Promise<Registration[]> {
  const items: Registration[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :reg)',
        ExpressionAttributeValues: { ':pk': eventPk(eventId), ':reg': 'REG#' },
        ExclusiveStartKey,
      }),
    );
    for (const i of res.Items ?? []) {
      items.push({
        confirmationId: i.confirmationId,
        eventId: i.eventId,
        name: i.name,
        email: i.email,
        organization: i.organization,
        status: i.status,
        createdAt: i.createdAt,
        cancelledAt: i.cancelledAt,
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}

/**
 * Cancels a registration atomically: marks it CANCELLED, releases the email guard so the
 * attendee may register again later, and frees the seat.
 */
export async function cancelRegistration(eventId: string, confirmationId: string, now = new Date()): Promise<void> {
  const pk = eventPk(eventId);
  const existing = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { PK: pk, SK: `REG#${confirmationId}` } }),
  );
  if (!existing.Item) throw new HttpError(404, 'REGISTRATION_NOT_FOUND', 'Registration not found.');
  if (existing.Item.status === 'CANCELLED') {
    throw new HttpError(409, 'ALREADY_CANCELLED', 'This registration is already cancelled.');
  }
  const cancelledAt = now.toISOString();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: { PK: pk, SK: `REG#${confirmationId}` },
              UpdateExpression: 'SET #s = :cancelled, cancelledAt = :now',
              ConditionExpression: '#s = :confirmed',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':confirmed': 'CONFIRMED', ':now': cancelledAt },
            },
          },
          {
            Delete: {
              TableName: tableName(),
              Key: { PK: pk, SK: `EMAIL#${existing.Item.email}` },
              ConditionExpression: 'confirmationId = :cid',
              ExpressionAttributeValues: { ':cid': confirmationId },
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: { PK: pk, SK: 'META' },
              UpdateExpression: 'SET registeredCount = registeredCount - :one, updatedAt = :now',
              ConditionExpression: 'registeredCount > :zero',
              ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':now': cancelledAt },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      throw new HttpError(409, 'CANCEL_CONFLICT', 'The registration changed while cancelling. Refresh and retry.');
    }
    throw err;
  }
}
