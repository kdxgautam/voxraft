#!/usr/bin/env bash
set -euo pipefail

revision=${1:-}
archive=${2:-}

[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid revision" >&2; exit 2; }
archive=$(realpath -- "$archive")
[[ $archive == /opt/actions-runner/_work/_temp/voxraft-image/voxraft-image.tar.gz ]] || {
  echo "Invalid image archive path" >&2
  exit 2
}
[[ -f $archive ]] || { echo "Image archive not found" >&2; exit 2; }

cd /opt/voxraft/app
image="voxraft-app:$revision"
previous=$(docker image inspect voxraft-app:latest --format '{{.Id}}' 2>/dev/null || true)
gzip -dc -- "$archive" | docker load
docker image inspect "$image" >/dev/null
docker tag "$image" voxraft-app:latest

compose=(docker compose --env-file .env.production -f compose.production.yml)
"${compose[@]}" up -d --no-build --force-recreate --remove-orphans

for _ in {1..30}; do
  container=$("${compose[@]}" ps -q app)
  status=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  [[ $status == healthy ]] && {
    docker image prune --all --force --filter until=168h >/dev/null
    echo "Deployed $revision"
    exit 0
  }
  [[ $status == unhealthy || $status == exited || $status == dead ]] && break
  sleep 2
done

"${compose[@]}" logs --tail 80 app caddy >&2 || true
if [[ -n $previous ]]; then
  docker tag "$previous" voxraft-app:latest
  "${compose[@]}" up -d --no-build --force-recreate --remove-orphans
fi
echo "Deployment failed; previous image restored" >&2
exit 1
