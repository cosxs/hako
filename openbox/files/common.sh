#!/bin/sh
# shellcheck disable=SC2034

CORE="/usr/bin/sing-box"
CORE_MIN_VERSION="1.14.0"
GENERATOR="/usr/share/openbox/ucode/generate.uc"
FIREWALL="/usr/share/openbox/ucode/firewall.uc"
MODE_SCRIPT="/usr/share/openbox/ucode/mode.uc"
INSPECT="/usr/share/openbox/ucode/inspect.uc"
SUBSCRIPTION_DIR="/etc/openbox/subscriptions"
RUN_DIR="/var/run/openbox"
RUN_CONFIG="$RUN_DIR/config.json"
LOG_DIR="/var/log/openbox"
APP_LOG="$LOG_DIR/app.log"
CORE_LOG="$LOG_DIR/core.log"
FIREWALL_STATE="$RUN_DIR/firewall.state"
DNSMASQ_STATE="$RUN_DIR/dnsmasq.state"
DNSMASQ_CONF="openbox.conf"

log() {
  mkdir -p "$LOG_DIR"
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$APP_LOG"
}

core_version() {
  "$CORE" version 2> /dev/null | sed -n 's/^sing-box version //p'
}

# version_ge A B: whether version A >= B, comparing the numeric x.y.z parts
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      if (x[i] + 0 > y[i] + 0) exit 0
      if (x[i] + 0 < y[i] + 0) exit 1
    }
    exit 0
  }'
}

# rotate_logs: append each log last written before today to its dated file
# (app-YYYY-MM-DD.log, core-YYYY-MM-DD.log) and empty it, keeping the file
# open for sing-box; then clean up old dated logs.
rotate_logs() {
  local name current day today

  today=$(date +%F)
  for name in app core; do
    current="$LOG_DIR/$name.log"
    [ -s "$current" ] || continue

    day=$(date -r "$current" +%F)
    if [ "$day" != "$today" ]; then
      cat "$current" >> "$LOG_DIR/$name-$day.log" && : > "$current"
    fi
  done

  clean_logs
}

# clean_logs: when logs.auto_clean is on, remove the dated logs older than
# logs.retention_days days, today included
clean_logs() {
  local days cutoff file day

  [ "$(uci -q get openbox.logs.auto_clean)" = 1 ] || return 0

  days=$(uci -q get openbox.logs.retention_days)
  case "$days" in
  '' | *[!0-9]* | 0) return 0 ;;
  esac

  cutoff=$(date -d "@$(($(date +%s) - (days - 1) * 86400))" +%Y%m%d)

  for file in "$LOG_DIR"/app-*.log "$LOG_DIR"/core-*.log; do
    [ -f "$file" ] || continue

    day=${file##*/}
    day=${day#*-}
    day=$(echo "${day%.log}" | tr -d '-')

    case "$day" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])
      if [ "$day" -lt "$cutoff" ]; then
        rm -f "$file"
      fi
      ;;
    esac
  done
}

# core_service_active: whether the service of the sing-box package, the
# official one or one built into the firmware, runs or starts at boot; it
# would then take over alongside OpenBox. Its init script starts sing-box
# only when sing-box.main.enabled is set as well.
core_service_active() {
  [ -x /etc/init.d/sing-box ] || return 1

  /etc/init.d/sing-box running 2> /dev/null && return 0

  /etc/init.d/sing-box enabled && [ "$(uci -q get sing-box.main.enabled)" = 1 ]
}

# core_service_off: OpenBox runs sing-box itself; stop and disable the
# service of the sing-box package so the two never run or take over at once
core_service_off() {
  local changed=

  [ -x /etc/init.d/sing-box ] || return 0

  if /etc/init.d/sing-box running 2> /dev/null; then
    /etc/init.d/sing-box stop 2> /dev/null
    changed=1

    # procd stops the instance after the call returns
    for i in 1 2 3 4 5 6 7 8 9 10; do
      /etc/init.d/sing-box running 2> /dev/null || break
      sleep 1
    done
  fi

  if /etc/init.d/sing-box enabled; then
    /etc/init.d/sing-box disable
    changed=1
  fi

  if [ "$(uci -q get sing-box.main.enabled)" = 1 ]; then
    uci set sing-box.main.enabled=0
    uci commit sing-box
    changed=1
  fi

  if [ -n "$changed" ]; then
    log "took over sing-box: stopped and disabled the service of its package"
  fi

  return 0
}

# set the outbound mode chosen in OpenBox on the running sing-box; $1 is how
# often to try, half a second apart, while sing-box is still starting
apply_mode() {
  ucode "$MODE_SCRIPT" "$RUN_CONFIG" "${1:-1}" >/dev/null 2>> "$APP_LOG"
}

# flush_dns_cache: dnsmasq caches the answers sing-box gives the router
# itself; drop them whenever sing-box starts or exits, so no fakeip address
# outlives it
flush_dns_cache() {
  killall -HUP dnsmasq 2> /dev/null || true
}

# inspect <what>: what the shell needs from the config sing-box runs, read by
# inspect.uc for the functions below named the same
inspect() {
  ucode "$INSPECT" "$RUN_CONFIG" "$1" 2> /dev/null
}

# dns_inbound: the listen address and port of the dns inbound (the direct one
# tagged dns-in) of the config sing-box runs, separated by a space
dns_inbound() {
  inspect dns_inbound
}

# tproxy_port: the listen port of the (first) tproxy inbound of the config
# sing-box runs
tproxy_port() {
  inspect tproxy_port
}

# wait_for_listen <port> <pid>: wait up to about 10 seconds, half a second
# apart, until a TCP port is listened on; fails at once when process <pid>
# exits (1), or when the time is up (2)
wait_for_listen() {
  local i=0

  while [ "$i" -lt 20 ]; do
    kill -0 "$2" 2> /dev/null || return 1
    netstat -lnt 2> /dev/null | awk -v p="$1" '$4 ~ ":" p "$" { found = 1 } END { exit !found }' && return 0
    ucode -e 'sleep(500)'
    i=$((i + 1))
  done

  return 2
}

# core_localtime: sing-box (Go) takes no POSIX TZ string such as CST-8, only
# a zoneinfo name or a TZif file, and OpenWrt has no zoneinfo by default.
# Write a TZif file holding just one UTC type and the zone of /etc/TZ as its
# footer, which Go uses for all times, and print its path. Only for sing-box:
# musl reads no such file, so other programs keep their TZ.
core_localtime() {
  local tz z h file="$RUN_DIR/localtime"

  tz=$(cat /etc/TZ 2> /dev/null)
  [ -n "$tz" ] || return 1

  # version 2 header and data, all counts 0 but one type and 4 chars
  z='\000\000\000\000'
  h="TZif2\000\000\000$z$z$z$z$z$z$z\000\000\000\001\000\000\000\004$z\000\000UTC\000"
  # shellcheck disable=SC2059
  printf "$h$h\n%s\n" "$tz" > "$file" || return 1
  echo "$file"
}

# dnsmasq_dirs: the conf-dir of each dnsmasq instance, as its init script
# sets it up
dnsmasq_dirs() {
  local section dir

  for section in $(uci -q -X show dhcp | sed -n 's/^dhcp\.\([^.=]*\)=dnsmasq$/\1/p'); do
    dir=$(uci -q get "dhcp.$section.confdir")
    dir="${dir:-/tmp/dnsmasq.$section.d}"
    dir="${dir%%,*}"
    case "$dir" in
    /*) echo "$dir" ;;
    esac
  done
}

# dnsmasq_up: while sing-box runs, dnsmasq sends the queries it does not
# answer itself (local names, private reverse lookups) to the dns inbound
# instead of its upstream servers. Those are often private addresses, such as
# the main router, and neither tun nor tproxy takes over the router's queries
# to them; so the router itself and the devices asking dnsmasq get the answers
# of sing-box too. The files written are kept in a state file.
dnsmasq_up() {
  local inbound server port dir

  dnsmasq_down

  inbound=$(dns_inbound)
  if [ -z "$inbound" ]; then
    log "no dns inbound in the running config: dnsmasq keeps its upstream servers"
    return 0
  fi

  server="${inbound% *}"
  port="${inbound#* }"

  for dir in $(dnsmasq_dirs); do
    mkdir -p "$dir"
    printf '# set up by OpenBox while sing-box runs\nno-resolv\nserver=%s#%s\n' \
      "$server" "$port" > "$dir/$DNSMASQ_CONF"
    echo "$dir/$DNSMASQ_CONF" >> "$DNSMASQ_STATE"
  done

  /etc/init.d/dnsmasq restart > /dev/null 2>&1
  log "dnsmasq sends its queries to sing-box ($server#$port)"
}

dnsmasq_down() {
  local file

  [ -f "$DNSMASQ_STATE" ] || return 0

  while read -r file; do
    rm -f "$file"
  done < "$DNSMASQ_STATE"
  rm -f "$DNSMASQ_STATE"

  /etc/init.d/dnsmasq restart > /dev/null 2>&1
  log "dnsmasq uses its upstream servers again"
}

# uses_tproxy: whether the config sing-box runs has a tproxy inbound, which
# needs the firewall OpenBox sets up (tun sets up its own)
uses_tproxy() {
  inspect uses_tproxy
}

# uses_tun_route: whether the config sing-box runs has a tun inbound that
# sets up routes and nftables rules (auto_route)
uses_tun_route() {
  inspect uses_tun_route
}

# tun_route_params: the route table, rule priority, input and output marks
# and fallback rule priority of that tun inbound, for core_cleanup
tun_route_params() {
  inspect tun_route_params
}

# core_cleanup <table> <priority> <input mark> <output mark> <fallback>: remove
# what a tun inbound with auto_route sets up, as given by tun_route_params.
# sing-box removes it itself when it stops, but not when it crashes or is
# killed, and its nftables table then sends traffic nowhere. Only the rules
# that look like its own are removed, one by one: at priorities <priority> to
# <priority>+3 those with its marks, table, goto or nop; at <fallback> those
# looking up its table; and at priority 1 the one auto_redirect adds for its
# redirect routes, whose table number is random and in no config.
core_cleanup() {
  local table="$1" start="$2" input="$3" output="$4" fallback="$5"
  local family pref rest

  nft delete table inet sing-box 2> /dev/null

  for family in -4 -6; do
    ip "$family" rule 2> /dev/null | awk -v table="$table" -v start="$start" \
      -v input="$input" -v output="$output" -v fallback="$fallback" '
      {
        pref = $1; sub(/:$/, "", pref); pref += 0
        rest = $0; sub(/^[^:]*:[ \t]*/, "", rest)
        line = " " rest " "
        if (pref >= start && pref <= start + 3 &&
            (line ~ " fwmark (" input "|" output ")[ /]" ||
             line ~ " lookup " table " " || line ~ / goto / || line ~ / nop /) ||
            pref == fallback && line ~ " lookup " table " " ||
            pref == 1 && rest ~ /^from all lookup [0-9]+$/ && $NF !~ /^(0|253|254|255)$/)
          print pref, rest
      }' | while read -r pref rest; do
      # shellcheck disable=SC2086
      ip "$family" rule del pref "$pref" $rest 2> /dev/null
      # the table of the redirect routes is left with them
      case "$pref $rest" in
      "1 from all lookup "*) ip "$family" route flush table "${rest##* }" 2> /dev/null ;;
      esac
    done
    ip "$family" route flush table "$table" 2> /dev/null
  done

  return 0
}

# firewall_up: the rules that send traffic to the tproxy inbound, and a route
# that delivers marked packets to the local host; what was set up is kept in
# a state file so it can be removed after the config changed
firewall_up() {
  local mark table priority

  firewall_down

  mark=$(uci -q get openbox.firewall.mark)
  table=$(uci -q get openbox.firewall.route_table)
  priority=$(uci -q get openbox.firewall.rule_priority)

  if ! ucode "$FIREWALL" "$RUN_CONFIG" "$RUN_DIR" > "$RUN_DIR/firewall.nft" 2>> "$APP_LOG" ||
     ! nft -f "$RUN_DIR/firewall.nft" 2>> "$APP_LOG"; then
    log "failed to set up the firewall for tproxy"
    nft delete table inet openbox 2> /dev/null
    return 1
  fi

  ip -4 rule add pref "$priority" fwmark "$mark" table "$table"
  ip -4 route add local default dev lo table "$table"
  if [ "$(uci -q get openbox.firewall.ipv6)" = 1 ]; then
    ip -6 rule add pref "$priority" fwmark "$mark" table "$table"
    ip -6 route add local default dev lo table "$table"
  fi
  echo "$priority $table" > "$FIREWALL_STATE"
  log "tproxy firewall set up"
}

firewall_down() {
  local priority table

  nft delete table inet openbox 2> /dev/null
  rm -f "$RUN_DIR/firewall.nft"

  if [ -f "$FIREWALL_STATE" ]; then
    read -r priority table < "$FIREWALL_STATE"
    ip -4 rule del pref "$priority" 2> /dev/null
    ip -4 route flush table "$table" 2> /dev/null
    ip -6 rule del pref "$priority" 2> /dev/null
    ip -6 route flush table "$table" 2> /dev/null
    rm -f "$FIREWALL_STATE"
    log "tproxy firewall removed"
  fi

  return 0
}
