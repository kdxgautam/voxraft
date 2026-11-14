#!/usr/bin/env bash
set -euo pipefail

revision=${1:-}
release=${2:-}

[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid revision" >&2; exit 2; }
release=$(realpath -- "$release")
[[ $release == /opt/actions-runner/_work/_temp/voxraft-release ]] || {
  echo "Invalid release path" >&2
  exit 2
}

archive=$release/voxraft-image.tar.gz
release_compose=$release/compose.production.yml
release_caddy=$release/deploy/Caddyfile
for file in "$archive" "$release_compose" "$release_caddy"; do
  [[ -f $file && ! -L $file ]] || { echo "Release file missing" >&2; exit 2; }
done

cd /opt/voxraft/app
image="voxraft-app:$revision"
previous=$(docker image inspect voxraft-app:latest --format '{{.Id}}' 2>/dev/null || true)
gzip -dc -- "$archive" | docker load
docker image inspect "$image" >/dev/null

docker compose --env-file .env.production -f "$release_compose" config --quiet
backup=$(mktemp -d /tmp/voxraft-deploy.XXXXXX)
cp compose.production.yml "$backup/compose.production.yml"
cp deploy/Caddyfile "$backup/Caddyfile"

compose=(docker compose --env-file .env.production -f compose.production.yml)
restore() {
  install -o root -g root -m 0644 "$backup/compose.production.yml" compose.production.yml
  install -o root -g root -m 0644 "$backup/Caddyfile" deploy/Caddyfile
  [[ -n $previous ]] && docker tag "$previous" voxraft-app:latest
  "${compose[@]}" up -d --no-build --force-recreate --remove-orphans
}
switched=false
cleanup() {
  code=$?
  trap - EXIT
  [[ $switched == false ]] || restore || true
  rm -rf -- "$backup"
  exit "$code"
}
trap cleanup EXIT

switched=true
install -o root -g root -m 0644 "$release_compose" compose.production.yml
install -o root -g root -m 0644 "$release_caddy" deploy/Caddyfile
docker tag "$image" voxraft-app:latest
"${compose[@]}" up -d --no-build --force-recreate --remove-orphans

for _ in {1..30}; do
  app_container=$("${compose[@]}" ps -q app)
  caddy_container=$("${compose[@]}" ps -q caddy)
  app_status=$(docker inspect "$app_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  caddy_status=$(docker inspect "$caddy_container" --format '{{.State.Status}}' 2>/dev/null || true)
  [[ $app_status == healthy && $caddy_status == running ]] && {
    switched=false
    docker image prune --all --force --filter until=168h >/dev/null
    echo "Deployed $revision"
    exit 0
  }
  [[ $app_status == unhealthy || $app_status == exited || $app_status == dead || $caddy_status == exited || $caddy_status == dead ]] && break
  sleep 2
done

"${compose[@]}" logs --tail 80 app caddy >&2 || true
echo "Deployment failed; previous image restored" >&2
exit 1
