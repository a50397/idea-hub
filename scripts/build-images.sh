#!/usr/bin/env bash
#
# Build (and optionally push) the IdeaHub production images for the target
# deployment platform — linux/amd64 by default, regardless of the machine you
# build on (arm64 Macs cross-build via Docker Desktop's emulation).
#
# Usage:
#   scripts/build-images.sh [VERSION] [options]
#
#   VERSION            image tag (default: latest), e.g. 1.2.0
#   --push             push to the registry instead of loading locally
#   --platform <p>     target platform (default: linux/amd64)
#   --api-url <u>      frontend VITE_API_URL build arg (default: /api)
#   --prefix <p>       image name prefix (default: fokips/ideahub)
#
# Examples:
#   scripts/build-images.sh 1.2.0                 # build both images locally
#   scripts/build-images.sh 1.2.0 --push          # build for amd64 and push
#
# Notes:
#   - Both Dockerfiles expect the REPOSITORY ROOT as build context; this script
#     handles that (run it from anywhere).
#   - Cross-platform `--load` needs Docker Desktop / a containerd image store.
#     If your daemon can't load foreign-arch images, use --push instead.
#   - After tagging a new VERSION, update the image tags in
#     docker-compose*.yml to match.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="latest"
PLATFORM="linux/amd64"
API_URL="/api"
PREFIX="fokips/ideahub"
OUTPUT="--load"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)      OUTPUT="--push"; shift ;;
    --platform)  PLATFORM="$2"; shift 2 ;;
    --api-url)   API_URL="$2"; shift 2 ;;
    --prefix)    PREFIX="$2"; shift 2 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          echo "Unknown option: $1" >&2; exit 1 ;;
    *)           VERSION="$1"; shift ;;
  esac
done

BACKEND_IMAGE="${PREFIX}-backend:${VERSION}"
FRONTEND_IMAGE="${PREFIX}-frontend:${VERSION}"

echo "==> Building ${BACKEND_IMAGE} for ${PLATFORM}"
docker buildx build \
  --platform "$PLATFORM" \
  -f backend/Dockerfile \
  -t "$BACKEND_IMAGE" \
  "$OUTPUT" \
  .

echo "==> Building ${FRONTEND_IMAGE} for ${PLATFORM} (VITE_API_URL=${API_URL})"
docker buildx build \
  --platform "$PLATFORM" \
  -f frontend/Dockerfile \
  --build-arg VITE_API_URL="$API_URL" \
  -t "$FRONTEND_IMAGE" \
  "$OUTPUT" \
  .

echo
echo "Done:"
echo "  ${BACKEND_IMAGE}"
echo "  ${FRONTEND_IMAGE}"
echo "  platform: ${PLATFORM}   output: ${OUTPUT#--}"
if [[ "$OUTPUT" == "--load" ]]; then
  echo "Tip: verify with  docker image inspect ${BACKEND_IMAGE} --format '{{.Os}}/{{.Architecture}}'"
fi
if [[ "$VERSION" != "latest" ]]; then
  echo "Remember to update the image tags in docker-compose*.yml to ${VERSION}."
fi
