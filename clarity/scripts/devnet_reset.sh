#!/usr/bin/env bash
set -Eeuo pipefail

# ---------------- cfg ----------------
PROJECT_BASENAME="${PROJECT_BASENAME:-clarity-sbtc-payments}"
PATTERN_RE="${PROJECT_BASENAME}(\.|-)devnet"     # matches ".devnet" and "-devnet"
KILL_BY_PORTS="${KILL_BY_PORTS:-0}"              # 1 = also nuke owners of :20443/:3999
DRY_RUN="${DRY_RUN:-0}"

say(){ printf '%s\n' "$*"; }
run(){ if [[ "$DRY_RUN" == "1" ]]; then echo "DRY_RUN ⇒ $*"; else eval "$@"; fi; }
dedupe(){ awk 'NF && !seen[$0]++'; }

# declare arrays up front so set -u never complains
declare -a CONTAINERS=() PORT_OWNERS=() ALL_CONTAINERS=()
declare -a VOL_SET=() NET_SET=() VOL_SWEEP=() NET_SWEEP=() ALL_VOLUMES=()

say "🔻 Full reset for *devnet* resources matching /$PATTERN_RE/"

# 1) containers by name (works even without compose labels)
say "→ Scanning containers by name…"
mapfile -t CONTAINERS < <(
  docker ps -a --format '{{.ID}} {{.Names}}' \
  | awk -v re="$PATTERN_RE" '$2 ~ re{print $1}'
)
if ((${#CONTAINERS[@]})); then
  say "   found: ${CONTAINERS[*]}"
else
  say "   none"
fi

# 2) optionally add anything bound to :20443 or :3999 (Stacks core/API)
if [[ "$KILL_BY_PORTS" == "1" ]]; then
  say "→ Scanning containers by ports (:20443, :3999)…"
  mapfile -t PORT_OWNERS < <(
    docker ps --format '{{.ID}} {{.Ports}}' \
    | awk '/:20443->|:3999->/ {print $1}' | dedupe
  )
  if ((${#PORT_OWNERS[@]})); then
    say "   found (by port): ${PORT_OWNERS[*]}"
  else
    say "   none"
  fi
fi

# 3) union targets (by name + by ports if enabled)
ALL_CONTAINERS=("${CONTAINERS[@]}")
if ((${#PORT_OWNERS[@]})); then ALL_CONTAINERS+=("${PORT_OWNERS[@]}"); fi
if ((${#ALL_CONTAINERS[@]})); then
  mapfile -t ALL_CONTAINERS < <(printf '%s\n' "${ALL_CONTAINERS[@]}" | dedupe)
  say "→ Targeting containers: ${ALL_CONTAINERS[*]}"
else
  say "→ No containers to target."
fi

# 4) from targets, collect attached volumes & networks (via inspect)
for cid in "${ALL_CONTAINERS[@]}"; do
  mapfile -t _v < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{printf "\n"}}{{end}}{{end}}' "$cid" 2>/dev/null || true)
  mapfile -t _n < <(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{printf "\n"}}{{end}}' "$cid" 2>/dev/null || true)
  if ((${#_v[@]})); then VOL_SET+=("${_v[@]}"); fi
  if ((${#_n[@]})); then NET_SET+=("${_n[@]}"); fi
done
if ((${#VOL_SET[@]})); then mapfile -t VOL_SET < <(printf '%s\n' "${VOL_SET[@]}" | dedupe); fi
if ((${#NET_SET[@]})); then mapfile -t NET_SET < <(printf '%s\n' "${NET_SET[@]}" | dedupe); fi

# 5) stop & remove containers first
if ((${#ALL_CONTAINERS[@]})); then
  say "→ Removing containers…"
  run "docker rm -f ${ALL_CONTAINERS[*]} || true"
fi

# 6) remove discovered networks (from inspect)
if ((${#NET_SET[@]})); then
  say "→ Removing networks (inspect): ${NET_SET[*]}"
  run "docker network rm ${NET_SET[*]} || true"
fi

# 7) sweep for any networks/volumes whose names match the devnet pattern
say "→ Safety sweep (names matching /$PATTERN_RE/)…"
mapfile -t NET_SWEEP < <(docker network ls --format '{{.Name}}' | grep -E "$PATTERN_RE" || true)
mapfile -t VOL_SWEEP < <(docker volume  ls --format '{{.Name}}' | grep -E "$PATTERN_RE" || true)

# 8) union + dedupe volumes from inspect + sweep, then remove
ALL_VOLUMES+=("${VOL_SET[@]}")
ALL_VOLUMES+=("${VOL_SWEEP[@]}")
if ((${#ALL_VOLUMES[@]})); then
  mapfile -t ALL_VOLUMES < <(printf '%s\n' "${ALL_VOLUMES[@]}" | dedupe)
  say "→ Removing volumes: ${ALL_VOLUMES[*]}"
  run "docker volume rm -f ${ALL_VOLUMES[*]} || true"
else
  say "→ No matching volumes"
fi

# 9) remove swept networks (after containers are gone)
if ((${#NET_SWEEP[@]})); then
  say "→ Removing networks (sweep): ${NET_SWEEP[*]}"
  run "docker network rm ${NET_SWEEP[*]} || true"
fi

# 10) clear Clarinet caches/artifacts
if [[ -d .cache ]]; then
  say "→ Removing Clarinet .cache"
  run "rm -rf .cache/* || sudo rm -rf .cache/*"
fi
if [[ -d .devnet ]]; then
  say "→ Removing project .devnet dir"
  run "rm -rf .devnet || sudo rm -rf .devnet"
fi

# 11) post-checks
say "→ Post-check: any matching containers still up?"
docker ps --format '{{.ID}} {{.Names}}' | awk -v re="$PATTERN_RE" '$2 ~ re {print; found=1} END{if(!found)print "   none"}'

say "→ Port owners:"
for p in 20443 3999; do
  owner="$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/:'"$p"'->/ {print $1; exit}')"
  if [[ -n "${owner:-}" ]]; then
    say "   :$p → $owner"
    if ! grep -Eq "$PATTERN_RE" <<<"$owner"; then
      say "   ⚠️  :$p is NON-devnet; if your CLI points here you’re talking to a different node."
    fi
  else
    say "   :$p free"
  fi
done

say "✅ Reset complete. (DRY_RUN=${DRY_RUN}, KILL_BY_PORTS=${KILL_BY_PORTS})"
say "Next:"
say "  clarinet devnet start --no-dashboard"
say "  # before redeploy, confirm 404 (contract truly gone):"
say "  curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:20443/v2/contracts/source/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM/sbtc-payment"
say "Then nuke only your devnet stuff: sudo ./scripts/devnet_reset.sh"
say "If you suspect a different Stacks node is still owning 20443/3999, run the aggressive mode:"
say "sudo KILL_BY_PORTS=1 ./scripts/devnet_reset.sh"
