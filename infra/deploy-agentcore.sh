#!/usr/bin/env bash
# Build the planner (Dockerfile.agentcore) on an arm64 CodeBuild host, push it to
# ECR, and run it on Bedrock AgentCore Runtime over the same DynamoDB table as the MCP
# server. Idempotent: creates the runtime once, then updates it to the new image.
#
#   AWS_REGION=us-east-1 ./infra/deploy-agentcore.sh
#
# Builds from git HEAD, so commit first. Prints the runtime ARN and a test invocation.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="carecircle-agent"
ECR_URI="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO"
BUCKET="carecircle-build-$ACCOUNT-$REGION"
NAME="carecircle_planner"
TABLE="${CARECIRCLE_TABLE:-carecircle}"
MODEL="${BEDROCK_MODEL_ID:-us.anthropic.claude-sonnet-4-5-20250929-v1:0}"
TAG=$(git rev-parse --short HEAD)

echo "==> ECR repository"
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO" --region "$REGION" >/dev/null

echo "==> Source bundle -> S3 ($TAG)"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null \
  || aws s3 mb "s3://$BUCKET" --region "$REGION" >/dev/null
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git archive --format=zip -o "$WORK/src.zip" HEAD
printf 'version: 0.2\nphases:\n  pre_build:\n    commands:\n      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin %s\n  build:\n    commands:\n      - docker build -f Dockerfile.agentcore -t %s:%s .\n  post_build:\n    commands:\n      - docker push %s:%s\n' \
  "$ECR_URI" "$ECR_URI" "$TAG" "$ECR_URI" "$TAG" > "$WORK/buildspec.yml"
(cd "$WORK" && zip -q src.zip buildspec.yml)
aws s3 cp "$WORK/src.zip" "s3://$BUCKET/agent-src.zip" --region "$REGION" >/dev/null

echo "==> CodeBuild project (arm64)"
# The MCP server's build role (infra/deploy-mcp.sh) already has what this build needs.
CB_ROLE_ARN=$(aws iam get-role --role-name carecircle-codebuild --query Role.Arn --output text) \
  || { echo "Run infra/deploy-mcp.sh once first: it creates the carecircle-codebuild role."; exit 1; }
PROJECT="carecircle-agent-build"
SRC="{\"type\":\"S3\",\"location\":\"$BUCKET/agent-src.zip\"}"
ENV='{"type":"ARM_CONTAINER","image":"aws/codebuild/amazonlinux-aarch64-standard:3.0","computeType":"BUILD_GENERAL1_SMALL","privilegedMode":true}'
if aws codebuild batch-get-projects --names "$PROJECT" --region "$REGION" --query 'projects[0].name' --output text 2>/dev/null | grep -q "$PROJECT"; then
  aws codebuild update-project --name "$PROJECT" --source "$SRC" --environment "$ENV" --service-role "$CB_ROLE_ARN" --region "$REGION" >/dev/null
else
  aws codebuild create-project --name "$PROJECT" --source "$SRC" \
    --artifacts '{"type":"NO_ARTIFACTS"}' --environment "$ENV" \
    --service-role "$CB_ROLE_ARN" --region "$REGION" >/dev/null
fi

echo "==> Building image (a few minutes)"
BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" --region "$REGION" --query 'build.id' --output text)
echo "    build: $BUILD_ID"
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" --query 'builds[0].buildStatus' --output text)
  [ "$STATUS" = "IN_PROGRESS" ] || break
  sleep 15
done
echo "    build status: $STATUS"
[ "$STATUS" = "SUCCEEDED" ] || { echo "Build failed - see CodeBuild logs for $BUILD_ID"; exit 1; }

echo "==> Runtime execution role"
ROLE="carecircle-agentcore-runtime"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "{
    \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",
    \"Principal\":{\"Service\":\"bedrock-agentcore.amazonaws.com\"},\"Action\":\"sts:AssumeRole\",
    \"Condition\":{\"StringEquals\":{\"aws:SourceAccount\":\"$ACCOUNT\"}}}]}" >/dev/null
  sleep 10
fi
# Written every deploy, so a role created earlier picks up what the runtime now needs.
# Bedrock on "*": a cross-region inference profile authorises against the profile and the
# foundation model in every region it routes to (see infra/deploy-mcp.sh). DynamoDB: what
# src/store/dynamo.ts calls (Get, Put, Scan, and transactions of Put, Update and Delete),
# on the one table.
aws iam put-role-policy --role-name "$ROLE" --policy-name inline --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"ecr:GetAuthorizationToken\"],\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"ecr:BatchGetImage\",\"ecr:GetDownloadUrlForLayer\"],
     \"Resource\":\"arn:aws:ecr:$REGION:$ACCOUNT:repository/$REPO\"},
    {\"Effect\":\"Allow\",\"Action\":[\"bedrock:InvokeModel\",\"bedrock:InvokeModelWithResponseStream\"],\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",
      \"dynamodb:Scan\",\"dynamodb:TransactWriteItems\"],
     \"Resource\":[\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE\",\"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE/index/*\"]},
    {\"Effect\":\"Allow\",\"Action\":[\"sns:Publish\"],\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"logs:CreateLogGroup\",\"logs:CreateLogStream\",\"logs:PutLogEvents\",\"logs:DescribeLogStreams\",\"logs:DescribeLogGroups\"],
     \"Resource\":\"arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/bedrock-agentcore/runtimes/*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"xray:PutTraceSegments\",\"xray:PutTelemetryRecords\"],\"Resource\":\"*\"},
    {\"Effect\":\"Allow\",\"Action\":[\"cloudwatch:PutMetricData\"],\"Resource\":\"*\",
     \"Condition\":{\"StringEquals\":{\"cloudwatch:namespace\":\"bedrock-agentcore\"}}}]}" >/dev/null
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

echo "==> AgentCore Runtime $NAME"
ARTIFACT="{\"containerConfiguration\":{\"containerUri\":\"$ECR_URI:$TAG\"}}"
NETWORK='{"networkMode":"PUBLIC"}'
PROTOCOL='{"serverProtocol":"HTTP"}'
VARS="CARECIRCLE_TABLE=$TABLE,AWS_REGION=$REGION,BEDROCK_MODEL_ID=$MODEL"
ID=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
  --query "agentRuntimes[?agentRuntimeName=='$NAME'].agentRuntimeId | [0]" --output text)
# AgentCore checks the role can pull the image before it accepts the runtime, and a policy
# written seconds ago may not have reached IAM yet: retry that refusal, nothing else.
runtime() {
  for attempt in 1 2 3 4 5 6 7 8 9; do
    if OUT=$("$@" 2>&1 >/dev/null); then return 0; fi
    echo "$OUT" | grep -q "Access denied while validating ECR URI" || { echo "$OUT"; return 1; }
    echo "    waiting for the role's ECR permissions to reach IAM ($attempt)"
    sleep 15
  done
  echo "$OUT"; return 1
}
if [ -z "$ID" ] || [ "$ID" = "None" ]; then
  runtime aws bedrock-agentcore-control create-agent-runtime --region "$REGION" --agent-runtime-name "$NAME" \
    --description "We've Got This planner: a Strands Agent over its MCP tools" \
    --agent-runtime-artifact "$ARTIFACT" --role-arn "$ROLE_ARN" --network-configuration "$NETWORK" \
    --protocol-configuration "$PROTOCOL" --environment-variables "$VARS"
  ID=$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
    --query "agentRuntimes[?agentRuntimeName=='$NAME'].agentRuntimeId | [0]" --output text)
else
  runtime aws bedrock-agentcore-control update-agent-runtime --region "$REGION" --agent-runtime-id "$ID" \
    --agent-runtime-artifact "$ARTIFACT" --role-arn "$ROLE_ARN" --network-configuration "$NETWORK" \
    --protocol-configuration "$PROTOCOL" --environment-variables "$VARS"
fi
while true; do
  STATE=$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$ID" --query status --output text)
  case "$STATE" in READY) break ;; *FAILED) echo "Runtime $STATE"; exit 1 ;; esac
  sleep 10
done
ARN=$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$ID" --query agentRuntimeArn --output text)
VERSION=$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$ID" --query agentRuntimeVersion --output text)
echo "    $ARN (version $VERSION, image $TAG)"

cat <<EOF

Try it (a session id is at least 33 characters):
  aws bedrock-agentcore invoke-agent-runtime --region $REGION --agent-runtime-arn $ARN \\
    --runtime-session-id carecircle-try-\$(date +%s)-0000000000000 --content-type application/json \\
    --payload '{"prompt":"How is Daddy doing today?","actorId":"m_david"}' --cli-binary-format raw-in-base64-out /dev/stdout
EOF
