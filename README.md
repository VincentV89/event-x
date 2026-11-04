# EventX

EventX is a serverless event registration and management platform. It ships with the demo event
**GovTech Stack X Conference 2026** (capacity 300) and 128 seeded mock registrations.

- **Public site**: conference banner, description, date, venue, live seat availability, and a registration form (name, email, organization). Each successful registration gets a unique confirmation ID (e.g. `EVX-7K2M9QF3XA`).
- **Organizer dashboard** (`/organizer`, requires Cognito sign-in and membership of the `organizers` group): KPI cards (total registrations, available seats, capacity %, cancellations), charts (seat utilization donut, cumulative registration trend, top organizations), a searchable, sortable, paginated attendee table, and registration cancellation.

## Architecture

```
Browser ──HTTPS──► CloudFront (OAC, security headers) ──► S3 (private bucket: React SPA + config.json)
   │
   ├──HTTPS──► API Gateway HTTP API ($default stage, throttled, CORS locked to the site origin)
   │             ├─ GET  /events                         ─┐
   │             ├─ GET  /events/{eventId}                ├─► Lambda "public" (Node.js 22, arm64)
   │             ├─ POST /events/{eventId}/registrations ─┘
   │             ├─ GET    /admin/events                                  ─┐ JWT authorizer (Cognito)
   │             ├─ GET    /admin/events/{eventId}/registrations           ├─► Lambda "admin" + organizers group check
   │             └─ DELETE /admin/events/{eventId}/registrations/{id}     ─┘
   │                                   │
   │                                   ▼
   │                         DynamoDB (on-demand, PITR, single table + sparse GSI)
   └──OAuth2 PKCE──► Cognito Hosted UI (organizer sign-in, self sign-up disabled)

CloudWatch Logs: one log group per Lambda + API access logs (2-week retention, no PII).
```

| Concern | Implementation |
|---|---|
| Hosting | Private S3 bucket + CloudFront Origin Access Control, HTTPS-only, CSP/HSTS/X-Frame-Options headers |
| API | API Gateway **HTTP API**, rate limit 50 rps / burst 100 |
| Compute | Two AWS Lambda functions (Node.js 22, TypeScript bundled with esbuild) |
| Data | DynamoDB on-demand, point-in-time recovery |
| Auth | Cognito user pool (Lite plan), Hosted UI, authorization-code + PKCE (no client secret in the browser) |
| IaC | AWS CDK v2 (TypeScript) - `infra/` |

### Data model (single table)

| PK | SK | Purpose |
|---|---|---|
| `EVENT#<eventId>` | `META` | Event details, `capacity`, `registeredCount`; `GSI1PK=EVENT` makes it listable |
| `EVENT#<eventId>` | `REG#<confirmationId>` | Registration (name, email, organization, status, timestamps) |
| `EVENT#<eventId>` | `EMAIL#<lower-cased email>` | Uniqueness guard - one active registration per email per event |

**Registration is one DynamoDB transaction** that (1) increments `registeredCount` only if
`registeredCount < capacity`, (2) creates the `EMAIL#` guard only if absent, and (3) creates the `REG#`
item. All three succeed or none do, so capacity and email uniqueness hold even under concurrent
requests (transaction conflicts are retried with jitter; the conditions are re-evaluated every time).
Cancellation is also transactional: marks the registration `CANCELLED`, deletes the email guard, and
decrements the counter.

### Security

- Public endpoints only return event details and aggregate counts - never attendee data. The public
  Lambda has no `Query`/`Scan` permission on the base table; it can only query the sparse event index.
- Organizer endpoints require a valid Cognito access token (API Gateway JWT authorizer) **and** the
  `organizers` group (checked in the Lambda) - authenticated non-organizers get `403`.
- Least-privilege IAM: each function gets only the DynamoDB actions it uses on this table/index.
- Input validation server-side (length, format, control characters, HTML brackets, 10 KB body limit) and client-side.
- CORS allows only the CloudFront origin (plus `http://localhost:5173` for local dev).
- Logs contain request ids, routes, event ids and confirmation ids only - never names, emails or organizations.
  API access logs omit source IP and user agent.
- No AWS credentials or secrets exist in the frontend. The browser receives only public identifiers
  (API URL, user pool id, app client id, Hosted UI domain) via `/config.json`, generated at deploy time.

## Project layout

```
backend/   Lambda handlers (TypeScript) + unit tests (vitest, aws-sdk-client-mock)
frontend/  React + TypeScript + Vite + Tailwind CSS + Cloudscape Design System
infra/     AWS CDK app (TypeScript) + template assertion tests
scripts/   deploy, seed, smoke-test, create-organizer, destroy
```

## Prerequisites

- Node.js 20+ and npm
- AWS CLI v2 with credentials for the target account (`aws sts get-caller-identity` must work)
- The account/region bootstrapped for CDK once: `npx cdk bootstrap aws://<ACCOUNT>/<REGION>`

## Deploy

```bash
export AWS_REGION=us-east-1          # any region; default us-east-1
npm run deploy                        # = scripts/deploy.sh
```

`deploy.sh` installs dependencies, runs the unit tests, builds the frontend, runs `cdk deploy`
(which creates all resources, uploads the site and writes `config.json` wired to the new API and
Cognito pool, then invalidates CloudFront), and seeds the demo data. It prints the website URL.

> If CDK reports *"no credentials have been configured"* while `aws sts get-caller-identity` works
> (some container/IDE runtimes), run `EVENTX_EXPORT_CLI_CREDENTIALS=1 npm run deploy`. The CLI's
> credentials are then passed to CDK in the deploy process's environment only.

The CloudFormation stack name is set in `infra/cdk.json` (`context.stackName`).

### Seed data

```bash
npm run seed                 # seeds "GovTech Stack X Conference 2026" if missing
node scripts/seed.mjs --reset   # wipes that event's items and re-seeds
```

The seed creates 120 confirmed + 8 cancelled fictitious registrations (emails use the reserved
`.example` TLD) spread over the past 30 days.

## Organizer login

Self sign-up is disabled. An administrator with AWS access invites organizers. No passwords are stored in this repository:

```bash
scripts/create-organizer.sh you@your-domain.com
```

1. Cognito emails `you@your-domain.com` a temporary password (valid 3 days).
2. Open `<WebsiteUrl>/organizer` and click **Sign in with Amazon Cognito**.
3. Enter the email and temporary password, then choose your own password (12+ characters, upper/lower case, digit, symbol).
4. You are redirected to the dashboard.

To grant an existing Cognito user access: `aws cognito-idp admin-add-user-to-group --user-pool-id <UserPoolId> --username <email> --group-name organizers`.
Forgotten passwords can be reset from the Hosted UI ("Forgot your password?").

## Tests

```bash
npm test          # backend unit tests + CDK template assertions
npm run smoke     # end-to-end checks against the deployed stack
```

The smoke test checks the public API, DynamoDB persistence, duplicate and validation errors, CORS,
**capacity under 25 concurrent requests** (on a temporary hidden event with capacity 5, removed
afterwards), 401/403/200 on organizer APIs (using temporary Cognito users it deletes again),
cancellation, and the CloudFront site, headers and runtime config.

## Local development

```bash
npm install
# After a deploy, point the dev server at the deployed backend:
node -e "const s=Object.values(require('./infra/outputs.json'))[0];require('fs').writeFileSync('frontend/public/config.json',JSON.stringify({apiUrl:s.ApiUrl,region:process.env.AWS_REGION||'us-east-1',userPoolId:s.UserPoolId,userPoolClientId:s.UserPoolClientId,cognitoDomain:s.CognitoDomain}))"
npm run dev -w frontend    # http://localhost:5173 (already allowed by CORS and as an OAuth callback)
```

## Cleanup

```bash
npm run destroy     # = scripts/destroy.sh -> cdk destroy
```

This deletes the stack and everything in it: CloudFront distribution, S3 bucket and its objects,
API, Lambdas, DynamoDB table (**all registration data**), Cognito user pool and its users, and log groups.
The shared CDK bootstrap stack (`CDKToolkit`) is left in place. Check for leftovers with
`aws cloudformation describe-stacks --stack-name <stackName>`. It should report that the stack does not exist.

## Cost notes

Everything is pay-per-use: DynamoDB on-demand, Lambda, HTTP API, CloudFront (PriceClass 100) and
Cognito Lite (free tier: 10,000 MAU). A demo with light traffic costs a few cents per month. The only
always-on items are S3 storage of the ~2 MB site and PITR on a tiny table.

## Supporting resources created by CDK

Besides the services above, CDK adds a few helper resources that are part of the deployment mechanism:
- a `BucketDeployment` custom-resource Lambda, which uploads the site and `config.json` and invalidates CloudFront
- an auto-delete-objects Lambda, which empties the site bucket on `cdk destroy`
- IAM roles for those helper Lambdas, also logged to CloudWatch

They run only during deploy and destroy.
