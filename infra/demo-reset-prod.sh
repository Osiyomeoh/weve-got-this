#!/usr/bin/env bash
# Record-day reset: fresh demo household in production, nothing else touched.
#
#   AWS_PROFILE=conductor bash infra/demo-reset-prod.sh            ride unclaimed
#   AWS_PROFILE=conductor bash infra/demo-reset-prod.sh --claimed  ride claimed by Renee
#
# 1. re-seeds only h_margaret in DynamoDB (scripts/demo-reset-prod.ts verifies every
#    other household is unchanged, reading back from the table),
# 2. restarts the MCP server so it reloads (it keeps the record in memory),
# 3. restarts the console so it drops its now-stale MCP session,
# 4. fires one signed Ring event so the connections board still shows Ring live,
# 5. reads the care gaps back through the live console as a final check.
set -euo pipefail
cd "$(dirname "$0")/.."

REGION=us-east-1
TABLE="${CARECIRCLE_TABLE:-carecircle}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
MCP_ARN="arn:aws:apprunner:$REGION:$ACCOUNT:service/carecircle-mcp/26c6192211474f7fa04ff8d8cb759424"
SIM_ARN="arn:aws:apprunner:$REGION:$ACCOUNT:service/carecircle-sim/399940e7f6f54ef9a02e7d39cf93addf"
MCP_URL=https://ypq2dfq2p7.us-east-1.awsapprunner.com
SIM_URL=https://krqi2tpsif.us-east-1.awsapprunner.com

status() { aws apprunner describe-service --region "$REGION" --service-arn "$1" --query Service.Status --output text; }
restart() {
  until [ "$(status "$1")" = RUNNING ]; do sleep 10; done
  aws apprunner start-deployment --region "$REGION" --service-arn "$1" --query OperationId --output text >/dev/null
  sleep 20
  until [ "$(status "$1")" = RUNNING ]; do sleep 10; done
}

echo "==> 1. Re-seed the demo household"
CARECIRCLE_TABLE="$TABLE" AWS_REGION="$REGION" npx tsx scripts/demo-reset-prod.ts --apply "$@"

echo "==> 2. Restart the MCP server so it reloads"
restart "$MCP_ARN"
echo "==> 3. Restart the console"
restart "$SIM_ARN"

echo "==> 4. One signed Ring event"
npx tsx --env-file-if-exists=.env src/demo/ring-simulate.ts --url "$MCP_URL/ring/webhook" --event package

echo "==> 5. Care gaps through the live console"
curl -s -X POST "$SIM_URL/api/act" -H 'content-type: application/json' \
  -d '{"memberId":"m_david","tool":"get_care_gaps","args":{}}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result"))'
