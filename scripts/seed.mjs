#!/usr/bin/env node
/**
 * Seeds the demo event "GovTech Stack X Conference 2026" with mock registrations.
 *   node scripts/seed.mjs            # seed if the event does not exist yet
 *   node scripts/seed.mjs --reset    # delete the event's items and re-seed
 * All attendee data is fictitious and uses the reserved ".example" TLD.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { REGION, stackOutputs } from './lib.mjs';

export const EVENT_ID = 'govtech-stack-x-2026';
const CONFIRMED = 120;
const CANCELLED = 8;

const FIRST = ['Aisha', 'Benjamin', 'Chen', 'Daniel', 'Elena', 'Farhan', 'Grace', 'Hui Min', 'Isaac', 'Jia Hui', 'Kumar', 'Li Wei', 'Mei Ling', 'Nur', 'Oliver', 'Priya', 'Qing', 'Rajesh', 'Siti', 'Thomas', 'Uma', 'Vanessa', 'Wei Jie', 'Xavier', 'Yusof', 'Zhi Hao', 'Amelia', 'Bryan', 'Charmaine', 'Darren'];
const LAST = ['Tan', 'Lim', 'Lee', 'Ng', 'Wong', 'Goh', 'Chua', 'Koh', 'Teo', 'Ong', 'Rahman', 'Ismail', 'Pillai', 'Nair', 'Singh', 'Fernandez', 'Chong', 'Yeo', 'Ho', 'Sim'];
const ORGS = [
  ['GovTech Singapore', 'govtech'], ['Smart Nation Group', 'smartnation'], ['Cyber Security Agency', 'csa'],
  ['IMDA', 'imda'], ['Ministry of Health', 'moh'], ['Land Transport Authority', 'lta'], ['DSTA', 'dsta'],
  ['National University of Singapore', 'nus'], ['Nanyang Technological University', 'ntu'], ['Amazon Web Services', 'aws'],
  ['Housing & Development Board', 'hdb'], ['Central Provident Fund Board', 'cpf'], ['Monetary Authority of Singapore', 'mas'],
  ['SingHealth', 'singhealth'], ['Accenture', 'accenture'], ['Grab', 'grab'], ['Singtel', 'singtel'], ['Synapxe', 'synapxe'],
];
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Deterministic PRNG so seeded data is stable between runs.
let s = 20261202;
const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rand() * a.length)];
const cid = () => 'EVX-' + Array.from(randomBytes(10), (b) => ALPHABET[b & 31]).join('');

export const EVENT_META = {
  PK: `EVENT#${EVENT_ID}`, SK: 'META', GSI1PK: 'EVENT', GSI1SK: '2026-12-02', entityType: 'EVENT',
  eventId: EVENT_ID,
  name: 'GovTech Stack X Conference 2026',
  tagline: 'Two days of cloud, AI, security and design for the builders of digital government.',
  description:
    'GovTech Stack X Conference 2026 brings together 300 engineers, product managers, designers and leaders from across the public sector and industry. ' +
    'Explore how the Singapore Government Tech Stack powers secure, scalable citizen services - with deep-dive sessions on serverless platforms, ' +
    'responsible generative AI, zero-trust security and accessible design systems, plus hands-on labs and a networking reception.',
  startDate: '2026-12-02', endDate: '2026-12-03',
  venue: 'Marina Bay Sands Expo & Convention Centre', city: 'Singapore',
  capacity: 300, registrationOpen: true,
  highlights: ['40+ talks across 5 tracks', 'Hands-on AWS serverless & GenAI labs', 'Meet the Government Tech Stack product teams', 'Networking reception & startup showcase'],
};

export function buildRegistrations(now = Date.now()) {
  const used = new Set();
  const items = [];
  for (let i = 0; i < CONFIRMED + CANCELLED; i++) {
    let first, last, org, email;
    do {
      first = pick(FIRST); last = pick(LAST); org = pick(ORGS);
      email = `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + `@${org[1]}.example`;
    } while (used.has(email));
    used.add(email);
    // Spread over the last 30 days with momentum towards today.
    const daysAgo = Math.floor(30 * Math.pow(rand(), 1.6));
    const createdAt = new Date(now - daysAgo * 86_400_000 - Math.floor(rand() * 86_400_000)).toISOString();
    const status = i < CONFIRMED ? 'CONFIRMED' : 'CANCELLED';
    items.push({
      PK: `EVENT#${EVENT_ID}`, SK: `REG#${cid()}`, entityType: 'REGISTRATION', eventId: EVENT_ID,
      name: `${first} ${last}`, email, organization: org[0], status, createdAt,
      ...(status === 'CANCELLED' ? { cancelledAt: new Date(Date.parse(createdAt) + 3_600_000).toISOString() } : {}),
    });
    items[i].confirmationId = items[i].SK.slice(4);
  }
  return items;
}

async function batchWrite(ddb, table, requests) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending = { [table]: requests.slice(i, i + 25) };
    for (let attempt = 0; pending && Object.keys(pending).length && attempt < 8; attempt++) {
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: pending }));
      pending = res.UnprocessedItems;
      if (pending && Object.keys(pending).length) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  const table = process.env.TABLE_NAME ?? stackOutputs().TableName;
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

  const existing = await ddb.send(new GetCommand({ TableName: table, Key: { PK: EVENT_META.PK, SK: 'META' } }));
  if (existing.Item && !reset) {
    console.log(`Event "${EVENT_META.name}" already seeded (${existing.Item.registeredCount} registrations). Use --reset to re-seed.`);
    return;
  }
  if (reset) {
    const keys = [];
    let ExclusiveStartKey;
    do {
      const r = await ddb.send(new QueryCommand({
        TableName: table, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': EVENT_META.PK },
        ProjectionExpression: 'PK, SK', ExclusiveStartKey,
      }));
      keys.push(...(r.Items ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    await batchWrite(ddb, table, keys.map((Key) => ({ DeleteRequest: { Key } })));
    console.log(`Removed ${keys.length} existing items.`);
  }

  const regs = buildRegistrations();
  const confirmed = regs.filter((r) => r.status === 'CONFIRMED');
  const guards = confirmed.map((r) => ({ PK: r.PK, SK: `EMAIL#${r.email}`, confirmationId: r.confirmationId, createdAt: r.createdAt }));
  const meta = { ...EVENT_META, registeredCount: confirmed.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await batchWrite(ddb, table, [...regs, ...guards].map((Item) => ({ PutRequest: { Item } })));
  // Write META last so the counter always matches the confirmed registrations.
  await batchWrite(ddb, table, [{ PutRequest: { Item: meta } }]);
  console.log(`Seeded "${meta.name}" into ${table}: ${confirmed.length} confirmed, ${regs.length - confirmed.length} cancelled, capacity ${meta.capacity}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
