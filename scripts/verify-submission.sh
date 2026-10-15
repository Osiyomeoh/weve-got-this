#!/usr/bin/env bash
# Checks the submission the way a judge would: public repo, claims backed by
# code on the default branch, live endpoint, and public bonus URLs.
# Usage: bash scripts/verify-submission.sh [extra-url ...]
#   extra-url: blog/social/video links; each must return 200.
set -u
REPO="Osiyomeoh/carecircle"
LIVE="https://ypq2dfq2p7.us-east-1.awsapprunner.com/mcp"
fail=0; warn=0
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
soft() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warn=$((warn+1)); }

echo "Repo"
meta=$(gh repo view "$REPO" --json visibility,licenseInfo,defaultBranchRef 2>/dev/null)
vis=$(jq -r .visibility <<<"$meta"); lic=$(jq -r '.licenseInfo.key // empty' <<<"$meta")
branch=$(jq -r .defaultBranchRef.name <<<"$meta")
# The rules allow public, or private and shared with Amazon's reviewers.
reviewers="chris-trag knmeiss giolaq anishamalde mosesroth emersonsklar"
if [ "$vis" = PUBLIC ]; then ok "public"
else
  have=$( { gh api "repos/$REPO/collaborators" -q '.[].login'; gh api "repos/$REPO/invitations" -q '.[].invitee.login'; } 2>/dev/null)
  missing=""; for u in $reviewers; do grep -qx "$u" <<<"$have" || missing="$missing $u"; done
  [ -z "$missing" ] && ok "private, all Amazon reviewers invited" || bad "private and not shared with:$missing (or make it public)"
  soft "private: also share with testing@devpost.com (not checkable here)"
fi
[ -n "$lic" ] && ok "license detected ($lic)" || bad "no license detected by GitHub"

git fetch -q origin "$branch" 2>/dev/null
ref="origin/$branch"
ahead=$(git rev-list --count "$ref..HEAD" 2>/dev/null || echo 0)
[ "$ahead" = 0 ] && ok "local work is on $branch" \
  || bad "$ahead local commit(s) not on $branch - judges will not see them"

echo "Claims backed by code on $branch (docs mention -> code must exist)"
claim() { # name, code regex, [public repo that holds the code, when it isn't ours]
  docs=$(git grep -liE "$2" "$ref" -- '*.md' | wc -l | tr -d ' ')
  code=$(git grep -liE "$2" "$ref" -- src scripts infra packages ':!*.md' ':!*.json' ':!scripts/verify-submission.sh' | wc -l | tr -d ' ')
  if [ "$code" -gt 0 ]; then ok "$1 (code files: $code)"
  elif [ -n "${3:-}" ] && git grep -qF "$3" "$ref" -- README.md; then
    ok "$1 (not ours: linked to $3)"
  elif [ "$docs" -gt 0 ]; then bad "$1 claimed in $docs doc(s) but no code"
  fi
}
claim "MCP SDK"              '@modelcontextprotocol/sdk'
claim "Streamable HTTP"      'StreamableHTTPServerTransport'
claim "DynamoDB"             'DynamoDB'
claim "SNS"                  '@aws-sdk/client-sns|SNSClient'
claim "Bedrock"              'BedrockRuntime|ConverseCommand|InvokeModel'
BRIDGE=https://github.com/KayLerch/alexa-skill-mcp-bridge
claim "Strands"              'strands'                            "$BRIDGE"
claim "AgentCore"            'bedrock-agentcore|BedrockAgentCore' "$BRIDGE"

echo "Secrets"
hits=$(git grep -nE 'AKIA[0-9A-Z]{16}|aws_secret_access_key\s*=' "$ref" | wc -l | tr -d ' ')
[ "$hits" = 0 ] && ok "no AWS keys on $branch" || bad "$hits possible AWS key(s) on $branch"
git ls-files --error-unmatch .env >/dev/null 2>&1 && bad ".env is tracked" || ok ".env not tracked"

echo "Live endpoint"
code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' -X POST "$LIVE" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}')
case "$code" in 200|401|403) ok "$LIVE answers ($code)";; *) bad "$LIVE returned $code";; esac

echo "Bonus and judge links"
for f in docs/FRICTION-LOG.md docs/PRODUCT-FEEDBACK.md docs/FEATURE-REQUESTS.md; do
  git cat-file -e "$ref:$f" 2>/dev/null && ok "$f on $branch" || bad "$f missing on $branch"
done
[ $# -eq 0 ] && soft "no blog/social/video URLs passed - pass them as arguments"
for u in "$@"; do
  c=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$u")
  [ "$c" = 200 ] && ok "$u" || bad "$u returned $c"
  git grep -qF "$u" "$ref" -- README.md && ok "  linked from README" || soft "  not linked from README"
done

echo; echo "FAIL: $fail  WARN: $warn"
[ "$fail" = 0 ]
