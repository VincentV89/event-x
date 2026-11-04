#!/usr/bin/env bash
# Invite an organizer. Cognito emails the user a one-time temporary password; on first sign-in
# the Hosted UI forces them to set their own password. No credentials are stored in this repo.
#   Usage: scripts/create-organizer.sh organizer@your-domain.com
set -euo pipefail
EMAIL="${1:?Usage: $0 <organizer-email>}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK="$(node -p "require('$ROOT/infra/cdk.json').context.stackName")"
out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
POOL="$(out UserPoolId)"; GROUP="$(out OrganizerGroup)"; URL="$(out WebsiteUrl)"

if aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$EMAIL" --region "$REGION" >/dev/null 2>&1; then
  echo "User $EMAIL already exists - ensuring organizer group membership."
else
  aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" --region "$REGION" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL >/dev/null
  echo "Invitation with a temporary password emailed to $EMAIL."
fi
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$GROUP" --region "$REGION"
echo "Done. Sign in at: $URL/organizer"
