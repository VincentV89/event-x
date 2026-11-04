import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

process.env.TABLE_NAME = 'test-table';
const { handler: publicHandler } = await import('../src/public.js');
const { handler: adminHandler, parseGroups } = await import('../src/admin.js');

const ddbMock = mockClient(DynamoDBDocumentClient);
const META = {
  PK: 'EVENT#govtech-stack-x-2026', SK: 'META', eventId: 'govtech-stack-x-2026', name: 'GovTech Stack X Conference 2026',
  description: 'd', startDate: '2026-12-02', endDate: '2026-12-03', venue: 'v', capacity: 300, registeredCount: 120,
};

function pub(routeKey: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters: { eventId: 'govtech-stack-x-2026' },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { requestId: 'r1' },
  } as unknown as APIGatewayProxyEventV2;
}

function admin(routeKey: string, groups: unknown, extra: Record<string, string> = {}): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    routeKey,
    pathParameters: { eventId: 'govtech-stack-x-2026', ...extra },
    requestContext: { requestId: 'r2', authorizer: { jwt: { claims: { sub: 'u1', 'cognito:groups': groups }, scopes: [] } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const cancelled = (codes: string[]) =>
  new TransactionCanceledException({
    message: 'cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

beforeEach(() => ddbMock.reset());

describe('public API', () => {
  it('returns aggregate event info without PII', async () => {
    ddbMock.on(GetCommand).resolves({ Item: META });
    const res = await publicHandler(pub('GET /events/{eventId}'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.event).toMatchObject({ capacity: 300, registeredCount: 120, availableSeats: 180, capacityPercent: 40 });
    expect(res.body).not.toContain('email');
  });

  it('registers an attendee and returns a confirmation id', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({ Item: { ...META, registeredCount: 121 } });
    const res = await publicHandler(pub('POST /events/{eventId}/registrations', { name: 'Ada Lovelace', email: 'ada@example.com', organization: 'GovTech' }));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body as string).confirmationId).toMatch(/^EVX-/);
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx[0].Update?.ConditionExpression).toContain('registeredCount < capacity');
    expect(tx[1].Put?.Item?.SK).toBe('EMAIL#ada@example.com');
  });

  it('maps duplicate email to 409 ALREADY_REGISTERED', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['None', 'ConditionalCheckFailed', 'None']));
    const res = await publicHandler(pub('POST /events/{eventId}/registrations', { name: 'Ada', email: 'ada@example.com', organization: 'Org' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body as string).error.code).toBe('ALREADY_REGISTERED');
  });

  it('maps capacity failure to 409 EVENT_FULL', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled(['ConditionalCheckFailed', 'None', 'None']));
    ddbMock.on(GetCommand).resolves({ Item: { ...META, registeredCount: 300 } });
    const res = await publicHandler(pub('POST /events/{eventId}/registrations', { name: 'Ada', email: 'ada@example.com', organization: 'Org' }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body as string).error.code).toBe('EVENT_FULL');
  });

  it('rejects invalid input with 400', async () => {
    const res = await publicHandler(pub('POST /events/{eventId}/registrations', { name: '', email: 'x' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('admin API', () => {
  it('parses cognito group claim formats', () => {
    expect(parseGroups('[organizers]')).toEqual(['organizers']);
    expect(parseGroups('[a organizers]')).toEqual(['a', 'organizers']);
    expect(parseGroups(['organizers'])).toEqual(['organizers']);
    expect(parseGroups(undefined)).toEqual([]);
  });

  it('forbids users outside the organizers group', async () => {
    const res = await adminHandler(admin('GET /admin/events/{eventId}/registrations', '[attendees]'));
    expect(res.statusCode).toBe(403);
  });

  it('lists registrations for organizers', async () => {
    ddbMock.on(GetCommand).resolves({ Item: META });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ confirmationId: 'EVX-0000000000', eventId: 'govtech-stack-x-2026', name: 'A', email: 'a@x.io', organization: 'O', status: 'CONFIRMED', createdAt: '2026-10-01T00:00:00Z' }],
    });
    const res = await adminHandler(admin('GET /admin/events/{eventId}/registrations', '[organizers]'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string).registrations).toHaveLength(1);
  });

  it('cancels a registration atomically', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...META, status: 'CONFIRMED', email: 'a@x.io' } });
    ddbMock.on(TransactWriteCommand).resolves({});
    const res = await adminHandler(
      admin('DELETE /admin/events/{eventId}/registrations/{confirmationId}', '[organizers]', { confirmationId: 'EVX-0000000000' }),
    );
    expect(res.statusCode).toBe(200);
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx).toHaveLength(3);
    expect(tx[1].Delete?.Key?.SK).toBe('EMAIL#a@x.io');
  });
});
