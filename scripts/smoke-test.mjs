#!/usr/bin/env node
/**
 * Smoke tests against the deployed stack:
 *  - public API (list/get event, register, duplicate, validation, CORS)
 *  - DynamoDB persistence of the new registration
 *  - capacity enforcement under 25 concurrent requests (temporary hidden event, removed afterwards)
 *  - organizer API: 401 without token, 403 for non-organizers, 200 list + cancel for organizers
 *  - CloudFront site + runtime config
 * Uses short-lived, randomly generated Cognito test users which are deleted at the end.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { REGION, stackOutputs } from './lib.mjs';

const out = stackOutputs();
const API = out.ApiUrl.replace(/\/$/, '');
const SITE = out.WebsiteUrl;
const TABLE = out.TableName;
const EVENT_ID = 'govtech-stack-x-2026';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const results = [];
let failed = 0;

function check(name, ok, info = '') {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

async function call(method, path, { body, token, origin } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--region', REGION, '--output', 'json']).toString() || '{}');
const strongPassword = () => `Ex!${randomBytes(18).toString('base64url')}9a`;

function tempUser(group) {
  const username = `smoke-${randomBytes(4).toString('hex')}@eventx.example`;
  const password = strongPassword();
  execFileSync('aws', ['cognito-idp', 'admin-create-user', '--user-pool-id', out.UserPoolId, '--username', username,
    '--message-action', 'SUPPRESS', '--user-attributes', `Name=email,Value=${username}`, 'Name=email_verified,Value=true', '--region', REGION]);
  execFileSync('aws', ['cognito-idp', 'admin-set-user-password', '--user-pool-id', out.UserPoolId, '--username', username,
    '--password', password, '--permanent', '--region', REGION]);
  if (group) execFileSync('aws', ['cognito-idp', 'admin-add-user-to-group', '--user-pool-id', out.UserPoolId, '--username', username, '--group-name', group, '--region', REGION]);
  const auth = aws('cognito-idp', 'admin-initiate-auth', '--user-pool-id', out.UserPoolId, '--client-id', out.UserPoolClientId,
    '--auth-flow', 'ADMIN_USER_PASSWORD_AUTH', '--auth-parameters', `USERNAME=${username},PASSWORD=${password}`);
  return { username, token: auth.AuthenticationResult.AccessToken };
}
const deleteUser = (u) => execFileSync('aws', ['cognito-idp', 'admin-delete-user', '--user-pool-id', out.UserPoolId, '--username', u, '--region', REGION]);

async function main() {
  console.log(`API ${API}\nSite ${SITE}\nTable ${TABLE}\n`);

  // ---- Public API ----
  const list = await call('GET', '/events');
  check('GET /events returns the seeded event', list.status === 200 && list.body.events.some((e) => e.name === 'GovTech Stack X Conference 2026'));
  check('Public responses contain no attendee PII', !JSON.stringify(list.body).includes('@'));
  const before = (await call('GET', `/events/${EVENT_ID}`)).body.event;
  check('GET /events/{id} returns aggregates', before.capacity === 300 && typeof before.availableSeats === 'number', `registered=${before.registeredCount} available=${before.availableSeats}`);

  const email = `smoke.${randomBytes(4).toString('hex')}@eventx.example`;
  const reg = await call('POST', `/events/${EVENT_ID}/registrations`, { body: { name: 'Smoke Tester', email, organization: 'EventX QA' } });
  check('POST registration returns 201 + confirmation id', reg.status === 201 && /^EVX-[0-9A-Z]{10}$/.test(reg.body.confirmationId), reg.body.confirmationId);
  const cid = reg.body.confirmationId;

  const item = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVENT#${EVENT_ID}`, SK: `REG#${cid}` } }));
  check('Registration persisted in DynamoDB', item.Item?.email === email && item.Item?.status === 'CONFIRMED', `PK=EVENT#${EVENT_ID} SK=REG#${cid}`);
  const after = (await call('GET', `/events/${EVENT_ID}`)).body.event;
  check('Registered count incremented', after.registeredCount === before.registeredCount + 1);

  const dup = await call('POST', `/events/${EVENT_ID}/registrations`, { body: { name: 'Smoke Tester', email: email.toUpperCase(), organization: 'EventX QA' } });
  check('Duplicate email rejected (409, case-insensitive)', dup.status === 409 && dup.body.error.code === 'ALREADY_REGISTERED');

  const bad = await call('POST', `/events/${EVENT_ID}/registrations`, { body: { name: 'X', email: 'nope', organization: '' } });
  check('Invalid input rejected (400 with field errors)', bad.status === 400 && Object.keys(bad.body.error.details).length === 3);

  const missing = await call('GET', '/events/does-not-exist');
  check('Unknown event returns 404', missing.status === 404);

  const corsOk = await call('GET', '/events', { origin: SITE });
  const corsBad = await call('GET', '/events', { origin: 'https://evil.example' });
  check('CORS allows the CloudFront origin only', corsOk.headers.get('access-control-allow-origin') === SITE && !corsBad.headers.get('access-control-allow-origin'));

  // ---- Concurrency / capacity ----
  const testEvent = `smoke-capacity-${randomBytes(3).toString('hex')}`;
  const CAP = 5, N = 25;
  await ddb.send(new PutCommand({ TableName: TABLE, Item: {
    PK: `EVENT#${testEvent}`, SK: 'META', eventId: testEvent, name: 'Capacity test', description: 'temp', startDate: '2026-12-02',
    endDate: '2026-12-02', venue: 'n/a', capacity: CAP, registeredCount: 0, registrationOpen: true, hidden: true,
  } }));
  try {
    const responses = await Promise.all(Array.from({ length: N }, (_, i) =>
      call('POST', `/events/${testEvent}/registrations`, { body: { name: `Load Tester ${i}`, email: `load${i}.${testEvent}@eventx.example`, organization: 'EventX QA' } })));
    const ok = responses.filter((r) => r.status === 201).length;
    const full = responses.filter((r) => r.status === 409 && r.body.error.code === 'EVENT_FULL').length;
    const meta = (await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVENT#${testEvent}`, SK: 'META' } }))).Item;
    const regs = (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p AND begins_with(SK, :r)',
      ExpressionAttributeValues: { ':p': `EVENT#${testEvent}`, ':r': 'REG#' } }))).Items;
    check(`Capacity holds under ${N} concurrent requests (cap ${CAP})`, ok === CAP && full === N - CAP && meta.registeredCount === CAP && regs.length === CAP,
      `201=${ok} EVENT_FULL=${full} other=${N - ok - full} count=${meta.registeredCount} items=${regs.length}`);
  } finally {
    const all = (await ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :p', ExpressionAttributeValues: { ':p': `EVENT#${testEvent}` }, ProjectionExpression: 'PK, SK' }))).Items;
    for (let i = 0; i < all.length; i += 25) {
      await ddb.send(new BatchWriteCommand({ RequestItems: { [TABLE]: all.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) } }));
    }
  }

  // ---- Organizer API ----
  const noAuth = await call('GET', `/admin/events/${EVENT_ID}/registrations`);
  check('Admin API without token returns 401', noAuth.status === 401);
  const forged = await call('GET', `/admin/events/${EVENT_ID}/registrations`, { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x' });
  check('Admin API with forged token returns 401', forged.status === 401);

  const visitor = tempUser();
  const organizer = tempUser(out.OrganizerGroup);
  try {
    const forbidden = await call('GET', `/admin/events/${EVENT_ID}/registrations`, { token: visitor.token });
    check('Authenticated non-organizer gets 403', forbidden.status === 403);

    const adminList = await call('GET', `/admin/events/${EVENT_ID}/registrations`, { token: organizer.token });
    check('Organizer can list attendees', adminList.status === 200 && adminList.body.registrations.some((r) => r.confirmationId === cid),
      `${adminList.body.registrations?.length} registrations`);

    const cancel = await call('DELETE', `/admin/events/${EVENT_ID}/registrations/${cid}`, { token: organizer.token });
    const cancelled = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVENT#${EVENT_ID}`, SK: `REG#${cid}` } }));
    const guard = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `EVENT#${EVENT_ID}`, SK: `EMAIL#${email}` } }));
    check('Organizer can cancel; seat released in DynamoDB', cancel.status === 200 && cancelled.Item.status === 'CANCELLED' && !guard.Item &&
      cancel.body.event.registeredCount === before.registeredCount);
    const again = await call('DELETE', `/admin/events/${EVENT_ID}/registrations/${cid}`, { token: organizer.token });
    check('Cancelling twice returns 409', again.status === 409);
  } finally {
    deleteUser(visitor.username);
    deleteUser(organizer.username);
    // Remove the smoke-test attendee record so the demo data stays clean.
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `EVENT#${EVENT_ID}`, SK: `REG#${cid}` } }));
  }

  // ---- Frontend ----
  const page = await fetch(SITE);
  const html = await page.text();
  check('CloudFront serves the app over HTTPS', page.status === 200 && html.includes('<div id="root">'));
  check('Security headers present', !!page.headers.get('content-security-policy') && !!page.headers.get('strict-transport-security'));
  const deep = await fetch(`${SITE}/organizer`);
  check('SPA deep link /organizer served', deep.status === 200);
  const cfg = await (await fetch(`${SITE}/config.json`)).json();
  check('Runtime config wires frontend to the deployed API', cfg.apiUrl.replace(/\/$/, '') === API && cfg.userPoolClientId === out.UserPoolClientId);

  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
