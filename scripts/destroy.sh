#!/usr/bin/env bash
# Removes every EventX resource (S3 site bucket + objects, CloudFront, API, Lambdas, DynamoDB table, Cognito pool, logs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$AWS_REGION" CDK_DEFAULT_REGION="$AWS_REGION"
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
cd "$ROOT/infra" && npx cdk destroy --force
rm -f "$ROOT/infra/outputs.json"
