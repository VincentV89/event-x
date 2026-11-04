#!/usr/bin/env bash
# End-to-end deploy: install, test, build frontend, CDK deploy (infra + site + runtime config), seed data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION" CDK_DEFAULT_REGION="$AWS_REGION"
# Some runtimes (e.g. role credentials only visible to the AWS CLI) need the CLI's credentials
# handed to CDK. Opt in with EVENTX_EXPORT_CLI_CREDENTIALS=1 - values stay in this process only.
if [ "${EVENTX_EXPORT_CLI_CREDENTIALS:-0}" = "1" ]; then eval "$(aws configure export-credentials --format env)"; fi
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Deploying to account $CDK_DEFAULT_ACCOUNT in $AWS_REGION"

npm ci
npm test
npm run build -w frontend
(cd infra && npx cdk deploy --require-approval never --outputs-file outputs.json)
node scripts/seed.mjs
node -e "const o=require('./infra/outputs.json');const s=Object.values(o)[0];console.log('\nWebsite: '+s.WebsiteUrl+'\nAPI:     '+s.ApiUrl)"
echo "Next: invite an organizer with scripts/create-organizer.sh <email>"
