#!/usr/bin/env bash
# scripts/local-smoke.sh
#
# Run the Azure LociTask locally with a simulated Azure Pipelines environment.
# Useful for iterating on backend changes without going through Azure DevOps.
#
# Usage:
#   ./scripts/local-smoke.sh push    # simulate a non-PR build (Build.Reason=Manual)
#   ./scripts/local-smoke.sh pr      # simulate a PR build (Build.Reason=PullRequest)
#
# Required env:
#   LOCI_API_KEY       API key for the backend you're pointing at.
#   INPUT_SCMTOKEN     Azure DevOps PAT used as the scmToken task input.
#
# Common overrides (have sane defaults):
#   LOCI_BACKEND_URL   default: http://localhost:8080
#   INPUT_PROJECT      default: smoke-test
#   INPUT_BINARIES     default: /usr/bin/git    (must be ELF on Linux)
#   INPUT_BASE         pr mode default: main@deadbee  (set to skip the
#                      backend's status-check on the base version)
#
# All Azure pipeline variables (Build.*, System.*) can be overridden by
# exporting them yourself before invoking — only unset ones get defaults.

set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "push" && "$MODE" != "pr" ]]; then
  cat >&2 <<EOF
Usage: $0 {push|pr}

  push   simulate a non-PR build (Build.Reason=Manual)
  pr     simulate a PR build (Build.Reason=PullRequest)

Set LOCI_API_KEY and (optionally) LOCI_BACKEND_URL before invoking.
EOF
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Activate the local venv if present so 'python' resolves to 3.12 and
# 'loci_api' is on PATH.
if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# Build the dist bundle on demand so a fresh checkout works without
# remembering to run npm run build:azure first.
if [[ ! -f azure/tasks/LociTask/dist/index.js ]]; then
  echo "==> azure/tasks/LociTask/dist/index.js missing — running npm run build:azure"
  npm run build:azure
fi

# Sanity checks — fail fast with clear messages instead of letting the task
# emit something cryptic.
: "${LOCI_API_KEY:?LOCI_API_KEY must be exported (use the key for whatever backend LOCI_BACKEND_URL points at)}"
: "${INPUT_SCMTOKEN:?INPUT_SCMTOKEN must be exported (Azure DevOps PAT used as the scmToken task input)}"

export LOCI_BACKEND_URL="${LOCI_BACKEND_URL:-http://localhost:8080}"
export AGENT_TEMPDIRECTORY="${AGENT_TEMPDIRECTORY:-/tmp}"

# LociTask inputs — exactly what task.json declares, mapped to INPUT_<NAME>.
export INPUT_MODE="${INPUT_MODE:-upload}"
export INPUT_PROJECT="${INPUT_PROJECT:-smoke-test}"
export INPUT_BINARIES="${INPUT_BINARIES:-/usr/bin/git}"
export INPUT_WAITBASE="${INPUT_WAITBASE:-false}"
export INPUT_OPTIMIZE="${INPUT_OPTIMIZE:-false}"

# Pipeline variables read by utils.PullRequestData and resolve.js.
export BUILD_REPOSITORY_NAME="${BUILD_REPOSITORY_NAME:-Loci-rules}"
export BUILD_REPOSITORY_ID="${BUILD_REPOSITORY_ID:-00000000-0000-0000-0000-000000000000}"
export SYSTEM_TEAMPROJECT="${SYSTEM_TEAMPROJECT:-ITQuarks}"
export SYSTEM_COLLECTIONURI="${SYSTEM_COLLECTIONURI:-https://dev.azure.com/ITQuarks/}"
export BUILD_REQUESTEDFOR="${BUILD_REQUESTEDFOR:-Local Tester}"
export BUILD_REQUESTEDFORID="${BUILD_REQUESTEDFORID:-00000000-0000-0000-0000-000000000001}"

case "$MODE" in
  push)
    export BUILD_REASON="Manual"
    export BUILD_SOURCEVERSION="${BUILD_SOURCEVERSION:-abcdef1234567890abcdef1234567890abcdef12}"
    export BUILD_SOURCEBRANCHNAME="${BUILD_SOURCEBRANCHNAME:-main}"
    ;;
  pr)
    export BUILD_REASON="PullRequest"
    export SYSTEM_PULLREQUEST_PULLREQUESTID="${SYSTEM_PULLREQUEST_PULLREQUESTID:-42}"
    export SYSTEM_PULLREQUEST_SOURCECOMMITID="${SYSTEM_PULLREQUEST_SOURCECOMMITID:-fedcba0987654321fedcba0987654321fedcba09}"
    export SYSTEM_PULLREQUEST_TARGETBRANCH="${SYSTEM_PULLREQUEST_TARGETBRANCH:-refs/heads/main}"
    export SYSTEM_PULLREQUEST_SOURCEBRANCH="${SYSTEM_PULLREQUEST_SOURCEBRANCH:-refs/heads/feature/smoke-test}"
    # Pass an explicit base so resolve.js doesn't try to resolve a
    # merge-base against the backend. The default matches the version
    # the push-mode smoke creates (BUILD_SOURCEVERSION=abcdef1234... →
    # main@abcdef1), so 'push' followed by 'pr' is self-consistent —
    # push creates the base, pr compares against it. Override
    # INPUT_BASE to use a different existing version, or set
    # INPUT_BASE='' to exercise the merge-base path (needs a git repo
    # with a synthetic merge commit at HEAD).
    export INPUT_BASE="${INPUT_BASE:-main@abcdef1}"
    ;;
esac

echo "==> LociTask local smoke (mode=$MODE)"
echo "    backend:  $LOCI_BACKEND_URL"
echo "    project:  $INPUT_PROJECT"
echo "    binaries: $INPUT_BINARIES"
if [[ "$MODE" == "pr" ]]; then
  echo "    PR:       #$SYSTEM_PULLREQUEST_PULLREQUESTID  base=$INPUT_BASE"
fi
echo

exec node azure/tasks/LociTask/dist/index.js
