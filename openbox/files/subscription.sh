#!/bin/sh
# Subscriptions: the nodes of a profile made from a subscription come from a
# URL that returns a full sing-box JSON config. The profile is the UCI package
# openbox_<name>, with url, update_interval, user_agent, last_update and
# last_error in its profile section; the download goes to
# $SUBSCRIPTION_DIR/<name>.json.
#   subscription.sh update <name>   download the subscription of a profile
#   subscription.sh due             update the subscriptions whose interval is up
# Prints one line per update; exits with 0 on success, or as listed below.
# FETCH_TIMEOUT overrides the download timeout in seconds (default 30).

. /lib/functions.sh
. /usr/share/openbox/common.sh

LOCK="/var/lock/openbox-subscription"
VERSION_FILE="/usr/share/openbox/version"
# cron checks hourly, a little after the updates of the hour before
DUE_SLACK=300

# exit codes, mapped to error names by the rpcd plugin
E_NOT_FOUND=1
E_DOWNLOAD=2
E_JSON=3
E_CHECK=4
E_BUSY=5
E_WRITE=6

say() {
  echo "$*"
  log "subscription: $*"
}

# duration_seconds <value>: a sing-box duration made of s, m, h and d parts
# ("24h", "1h30m") in seconds; "0" is 0, anything else fails
duration_seconds() {
  [ "$1" = 0 ] && { echo 0; return 0; }

  echo "$1" | awk '{
    s = $0; total = 0
    while (match(s, /^[0-9]+[smhd]/)) {
      n = substr(s, 1, RLENGTH - 1); u = substr(s, RLENGTH, 1)
      total += n * (u == "s" ? 1 : u == "m" ? 60 : u == "h" ? 3600 : 86400)
      s = substr(s, RLENGTH + 1)
    }
    if (s != "" || $0 == "") exit 1
    print total
  }'
}

user_agent() {
  local sing_box openbox

  sing_box=$(core_version)
  openbox=$(cat "$VERSION_FILE" 2> /dev/null)
  echo "${sing_box:+sing-box/$sing_box }OpenBox/${openbox:-unknown}"
}

# record_error <package> <reason>
record_error() {
  uci set "$1.profile.last_error=$2"
  uci commit "$1"
}

valid_json() {
  ucode -e 'import { readfile } from "fs";
    try { exit(type(json(readfile(ARGV[0]) ?? "")) == "object" ? 0 : 1); } catch (e) { exit(1); }' "$1" 2> /dev/null
}

# update <name>: download, check and replace a subscription; a running
# service using it is reloaded. Fails without touching the old content.
update() {
  local name="$1" pkg="openbox_$1" url agent temp msg target="$SUBSCRIPTION_DIR/$1.json" changed=1

  # lowercase letters, digits and "_", as profile names are
  case "$name" in
  '' | *[!a-z0-9_]*) say "invalid name: $name"; return $E_NOT_FOUND ;;
  esac

  url=$(uci -q get "$pkg.profile.url")
  if [ -z "$url" ]; then
    say "$name: no subscription"
    return $E_NOT_FOUND
  fi

  # some providers answer with the format their UA asks for
  agent=$(uci -q get "$pkg.profile.user_agent")
  [ -n "$agent" ] || agent=$(user_agent)
  mkdir -p "$RUN_DIR"
  temp=$(mktemp -d /tmp/openbox-sub.XXXXXX) || return $E_WRITE

  # not quiet: its last line tells why it failed, like "HTTP error 404"
  if ! uclient-fetch -T "${FETCH_TIMEOUT:-30}" -O "$temp/download.json" \
    --user-agent "$agent" "$url" > "$temp/fetch.log" 2>&1; then
    msg=$(grep -v '^$' "$temp/fetch.log" | tail -n 1)
    rm -rf "$temp"
    record_error "$pkg" "download failed${msg:+: $msg}"
    say "$name: download failed${msg:+: $msg}"
    return $E_DOWNLOAD
  fi

  if ! valid_json "$temp/download.json"; then
    rm -rf "$temp"
    record_error "$pkg" "not a JSON config"
    say "$name: the download is not a JSON config"
    return $E_JSON
  fi

  if [ -x "$CORE" ] &&
     ! "$CORE" check -c "$temp/download.json" -D "$RUN_DIR" > "$temp/check.log" 2>&1; then
    msg=$(sed 's/\x1b\[[0-9;]*m//g' "$temp/check.log" | grep -v '^$' | tail -n 1)
    rm -rf "$temp"
    record_error "$pkg" "sing-box check failed${msg:+: $msg}"
    say "$name: sing-box check failed${msg:+: $msg}"
    return $E_CHECK
  fi

  if cmp -s "$temp/download.json" "$target"; then
    changed=
  else
    # copied next to the old content first, so the rename replaces it at once
    mkdir -p "$SUBSCRIPTION_DIR"
    if ! cp -f "$temp/download.json" "$SUBSCRIPTION_DIR/.$name.new" ||
       ! mv -f "$SUBSCRIPTION_DIR/.$name.new" "$target"; then
      rm -rf "$temp" "$SUBSCRIPTION_DIR/.$name.new"
      record_error "$pkg" "unable to write the subscription"
      say "$name: unable to write the subscription"
      return $E_WRITE
    fi
  fi
  rm -rf "$temp"

  uci set "$pkg.profile.last_update=$(date +%s)"
  uci -q delete "$pkg.profile.last_error"
  uci commit "$pkg"

  if [ -z "$changed" ]; then
    say "$name: unchanged"
  elif [ "$(uci -q get openbox.main.profile)" = "$name" ] &&
       /etc/init.d/openbox running; then
    /etc/init.d/openbox reload 9>&-
    say "$name: updated, OpenBox reloaded"
  else
    say "$name: updated"
  fi
}

# due_one <name>: collect the subscription of a profile when its interval is up
due_one() {
  local name="$1" pkg="openbox_$1" interval seconds last

  interval=$(uci -q get "$pkg.profile.update_interval")
  last=$(uci -q get "$pkg.profile.last_update")

  [ -n "$(uci -q get "$pkg.profile.url")" ] && [ -n "$interval" ] || return 0

  if ! seconds=$(duration_seconds "$interval"); then
    say "$name: invalid update interval: $interval"
    return 0
  fi
  [ "$seconds" -gt 0 ] || return 0

  case "$last" in
  '' | *[!0-9]*) last=0 ;;
  esac
  [ $(($(date +%s) - last + DUE_SLACK)) -ge "$seconds" ] || return 0

  DUE_NAMES="$DUE_NAMES $name"
}

due() {
  local file name

  DUE_NAMES=
  for file in /etc/config/openbox_*; do
    [ -f "$file" ] || continue
    name=${file#/etc/config/openbox_}
    case "$name" in
    '' | *[!a-z0-9_]*) continue ;;
    esac
    due_one "$name"
  done

  for name in $DUE_NAMES; do
    update "$name"
  done

  return 0
}

# one update at a time, released when the script exits
mkdir -p "${LOCK%/*}"
exec 9> "$LOCK"

case "$1" in
update)
  [ -n "$2" ] || { echo "usage: $0 update <name>" >&2; exit 1; }
  # the page is told when another one runs
  flock -n 9 || { echo "$2: another update is running"; exit $E_BUSY; }
  update "$2"
  ;;
due)
  flock 9
  due
  ;;
*)
  echo "usage: $0 update <name>|due" >&2
  exit 1
  ;;
esac
