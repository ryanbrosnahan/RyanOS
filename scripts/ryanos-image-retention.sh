#!/usr/bin/env bash
# Source this file after lenovo-deploy-safety.sh. The same functions run on the
# developer Mac and, via declare -f, on Lenovo after a successful deployment.

ryanos_image_docker() {
  local host="$1"
  shift
  if [[ "$host" == remote ]]; then
    ryanos_guarded_run 20 docker "$@"
  else
    docker "$@"
  fi
}

ryanos_retire_images() {
  local host="$1" release_tag="$2" action="${3:-dry-run}"
  local current_id release_id rollback_tag='' tag image_id container_id
  local image_tags container_ids candidate_count=0 failed=0
  local -a container_image_ids=()

  [[ "$host" == remote || "$host" == local ]] || { echo 'Expected local or remote image cleanup.' >&2; return 2; }
  [[ "$action" == dry-run || "$action" == apply ]] || { echo 'Expected dry-run or apply.' >&2; return 2; }
  [[ "$release_tag" =~ ^ryanos-app:server-[0-9a-f]{12}$ ]] || { echo 'Expected an exact RyanOS release tag.' >&2; return 2; }

  if [[ "$host" == remote ]]; then
    ryanos_docker_preflight || return 1
  else
    # Docker Desktop's CLI can hang when its engine has failed. Do not let
    # post-deployment cleanup block the already successful deployment.
    if [[ "$(docker context show 2>/dev/null)" != desktop-linux ]] ||
      [[ "$(curl --unix-socket "${HOME}/.docker/run/docker.sock" --max-time 5 -fsS http://localhost/_ping 2>/dev/null || true)" != OK ]]; then
      echo 'Mac Docker engine is unavailable; local image cleanup skipped.' >&2
      return 1
    fi
  fi

  release_id="$(ryanos_image_docker "$host" image inspect --format '{{.Id}}' "$release_tag")" || return 1
  current_id="$(ryanos_image_docker "$host" image inspect --format '{{.Id}}' ryanos-app:server 2>/dev/null || true)"
  [[ -n "$release_id" ]] || return 1
  if [[ "$host" == remote ]]; then
    [[ "$current_id" == "$release_id" ]] || { echo 'Lenovo server tag differs from the verified release; cleanup skipped.' >&2; return 1; }
    for container_id in ryanos-api ryanos-web ryanos-worker; do
      image_id="$(ryanos_image_docker "$host" inspect --format '{{.Image}}' "$container_id")" || return 1
      [[ "$image_id" == "$release_id" ]] || { echo "${container_id} uses a different image; cleanup skipped." >&2; return 1; }
    done
    curl -fsS --max-time 8 http://127.0.0.1:"${WEB_PORT:-3100}"/api/health >/dev/null || return 1
  fi

  image_tags="$(ryanos_image_docker "$host" image ls --format '{{.Repository}}:{{.Tag}}')" || return 1
  if [[ "$host" == remote ]]; then
    while IFS= read -r tag; do
      [[ "$tag" =~ ^ryanos-app:rollback-[0-9]{8}T[0-9]{6}Z$ ]] || continue
      if [[ -z "$rollback_tag" || "$tag" > "$rollback_tag" ]]; then rollback_tag="$tag"; fi
    done <<< "$image_tags"
    if [[ -n "$rollback_tag" ]]; then
      ryanos_image_docker "$host" image inspect "$rollback_tag" >/dev/null || return 1
    fi
    printf 'Lenovo keeping current release %s and rollback %s.\n' "$release_tag" "${rollback_tag:-none}"
  fi

  container_ids="$(ryanos_image_docker "$host" ps -aq --no-trunc)" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    image_id="$(ryanos_image_docker "$host" inspect --format '{{.Image}}' "$container_id")" || return 1
    container_image_ids+=("$image_id")
  done <<< "$container_ids"

  while IFS= read -r tag; do
    [[ "$tag" =~ ^ryanos-app:(server-[0-9a-f]{12}|rollback-[0-9]{8}T[0-9]{6}Z)$ ]] || {
      if [[ "$host" == local && "$tag" == ryanos-app:server && "$current_id" == "$release_id" ]]; then :; else continue; fi
    }
    if [[ "$host" == remote ]]; then
      [[ "$tag" == "$release_tag" || "$tag" == "$rollback_tag" ]] && continue
    elif [[ "$tag" == "$release_tag" && "$current_id" != "$release_id" ]]; then
      echo "Keeping ${tag}: another local build replaced the server tag."
      continue
    fi

    image_id="$(ryanos_image_docker "$host" image inspect --format '{{.Id}}' "$tag")" || { failed=1; continue; }
    for container_id in "${container_image_ids[@]}"; do
      if [[ "$container_id" == "$image_id" ]]; then
        echo "Keeping ${tag}: a local container still uses this image."
        image_id=''
        break
      fi
    done
    [[ -n "$image_id" ]] || continue
    candidate_count=$((candidate_count + 1))
    if [[ "$action" == dry-run ]]; then
      printf 'Would remove %s\n' "$tag"
    else
      printf 'Removing %s\n' "$tag"
      ryanos_image_docker "$host" image rm "$tag" || failed=1
    fi
  done <<< "$image_tags"

  printf '%s RyanOS image tag(s) eligible on %s.\n' "$candidate_count" "$host"
  [[ "$failed" == 0 ]]
}
