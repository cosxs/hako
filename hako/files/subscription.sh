#!/bin/sh
# Subscriptions: a profile, the UCI package hako_<profile>, may take nodes
# from its subscription sections, each a URL that returns a full sing-box JSON
# config, with url, update_interval, user_agent, last_update and last_error;
# the download goes to $SUBSCRIPTION_DIR/<profile>/<subscription>.json.
#   subscription.sh update <profile> <subscription>   download one subscription
#   subscription.sh due        update the subscriptions of all profiles whose interval is up
# Prints one line per update; exits with 0 on success, or as listed below. A
# running service whose profile was updated is reloaded, once.
# FETCH_TIMEOUT overrides the download timeout in seconds (default 30).

. /lib/functions.sh
. /usr/share/hako/common.sh

LOCK="/var/lock/hako-subscription"
VERSION_FILE="/usr/share/hako/version"
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
  local sing_box hako

  sing_box=$(core_version)
  hako=$(cat "$VERSION_FILE" 2> /dev/null)
  echo "${sing_box:+sing-box/$sing_box }Hako/${hako:-unknown}"
}

# record_error <package> <subscription> <reason>
record_error() {
  uci set "$1.$2.last_error=$3"
  uci commit "$1"
}

valid_json() {
  ucode -e 'import { readfile } from "fs";
    try { exit(type(json(readfile(ARGV[0]) ?? "")) == "object" ? 0 : 1); } catch (e) { exit(1); }' "$1" 2> /dev/null
}

# nodes_only <download> <output>: what a subscription gives, its outbounds and
# endpoints. The rest of what a provider sends, its DNS, its rules and the rule
# set files they name, is not taken: the nodes resolve their servers with the
# DNS of the profile, here a local resolver standing in for it
nodes_only() {
  ucode -e 'import { readfile, writefile } from "fs";
    const config = json(readfile(ARGV[0]));
    const nodes = {
      dns: { servers: [ { type: "local", tag: "check" } ] },
      route: { default_domain_resolver: "check" }
    };
    for (let key in [ "outbounds", "endpoints" ]) {
      if (type(config[key]) != "array") continue;
      for (let node in config[key])
        if (type(node) == "object") delete node.domain_resolver;
      nodes[key] = config[key];
    }
    exit(writefile(ARGV[1], nodes) != null ? 0 : 1);' "$1" "$2" 2> /dev/null
}

# update <profile> <subscription>: download, check and replace a
# subscription; UPDATED gets the profile when the content changed. Fails
# without touching the old content.
update() {
  local profile="$1" id="$2" pkg="hako_$1" label="$1/$2" url agent temp msg dir target changed=1

  # lowercase letters, digits and "_", as profile names are; a subscription
  # is named as a UCI section
  case "$profile" in
  '' | *[!a-z0-9_]*) say "invalid profile: $profile"; return $E_NOT_FOUND ;;
  esac
  case "$id" in
  '' | *[!A-Za-z0-9_]*) say "invalid subscription: $id"; return $E_NOT_FOUND ;;
  esac

  url=$(uci -q get "$pkg.$id.url")
  if [ "$(uci -q get "$pkg.$id")" != subscription ] || [ -z "$url" ]; then
    say "$label: no such subscription"
    return $E_NOT_FOUND
  fi

  dir="$SUBSCRIPTION_DIR/$profile"
  target="$dir/$id.json"

  # some providers answer with the format their UA asks for
  agent=$(uci -q get "$pkg.$id.user_agent")
  [ -n "$agent" ] || agent=$(user_agent)
  mkdir -p "$RUN_DIR"
  temp=$(mktemp -d /tmp/hako-sub.XXXXXX) || return $E_WRITE

  # not quiet: its last line tells why it failed, like "HTTP error 404"
  if ! uclient-fetch -T "${FETCH_TIMEOUT:-30}" -O "$temp/download.json" \
    --user-agent "$agent" "$url" > "$temp/fetch.log" 2>&1; then
    msg=$(grep -v '^$' "$temp/fetch.log" | tail -n 1)
    rm -rf "$temp"
    record_error "$pkg" "$id" "download failed${msg:+: $msg}"
    say "$label: download failed${msg:+: $msg}"
    return $E_DOWNLOAD
  fi

  if ! valid_json "$temp/download.json"; then
    rm -rf "$temp"
    record_error "$pkg" "$id" "not a JSON config"
    say "$label: the download is not a JSON config"
    return $E_JSON
  fi

  if [ -x "$CORE" ] && ! { nodes_only "$temp/download.json" "$temp/nodes.json" &&
     "$CORE" check -c "$temp/nodes.json" -D "$RUN_DIR" > "$temp/check.log" 2>&1; }; then
    msg=$(sed 's/\x1b\[[0-9;]*m//g' "$temp/check.log" | grep -v '^$' | tail -n 1)
    rm -rf "$temp"
    record_error "$pkg" "$id" "sing-box check failed${msg:+: $msg}"
    say "$label: sing-box check failed${msg:+: $msg}"
    return $E_CHECK
  fi

  if cmp -s "$temp/download.json" "$target"; then
    changed=
  else
    # copied next to the old content first, so the rename replaces it at once
    mkdir -p "$dir"
    if ! cp -f "$temp/download.json" "$dir/.$id.new" ||
       ! mv -f "$dir/.$id.new" "$target"; then
      rm -rf "$temp" "$dir/.$id.new"
      record_error "$pkg" "$id" "unable to write the subscription"
      say "$label: unable to write the subscription"
      return $E_WRITE
    fi
  fi
  rm -rf "$temp"

  uci set "$pkg.$id.last_update=$(date +%s)"
  uci -q delete "$pkg.$id.last_error"
  uci commit "$pkg"

  if [ -z "$changed" ]; then
    say "$label: unchanged"
  else
    UPDATED="$UPDATED $profile"
    say "$label: updated"
  fi
}

# reloads a running service whose profile was updated
reload_updated() {
  local current

  current=$(uci -q get hako.main.profile)
  [ -n "$current" ] || current=default

  case " $UPDATED " in
  *" $current "*) ;;
  *) return 0 ;;
  esac

  /etc/init.d/hako running || return 0
  /etc/init.d/hako reload 9>&-
  say "$current: Hako reloaded"
}

# due_one <profile> <subscription>: collect a subscription when its interval
# is up; one switched off is not updated
due_one() {
  local pkg="hako_$1" interval seconds last

  [ "$(uci -q get "$pkg.$2.enabled")" != 0 ] || return 0

  interval=$(uci -q get "$pkg.$2.update_interval")
  last=$(uci -q get "$pkg.$2.last_update")

  [ -n "$(uci -q get "$pkg.$2.url")" ] && [ -n "$interval" ] || return 0

  if ! seconds=$(duration_seconds "$interval"); then
    say "$1/$2: invalid update interval: $interval"
    return 0
  fi
  [ "$seconds" -gt 0 ] || return 0

  case "$last" in
  '' | *[!0-9]*) last=0 ;;
  esac
  [ $(($(date +%s) - last + DUE_SLACK)) -ge "$seconds" ] || return 0

  DUE="$DUE $1/$2"
}

# the subscriptions of every profile, whether in use or not
due() {
  local file profile id item

  DUE=
  for file in /etc/config/hako_*; do
    [ -f "$file" ] || continue
    profile=${file#/etc/config/hako_}
    case "$profile" in
    '' | *[!a-z0-9_]*) continue ;;
    esac

    for id in $(uci -q -X show "hako_$profile" |
      sed -n "s/^hako_$profile\.\([A-Za-z0-9_]*\)=subscription\$/\1/p"); do
      due_one "$profile" "$id"
    done
  done

  for item in $DUE; do
    update "${item%%/*}" "${item#*/}"
  done

  reload_updated
  return 0
}

# one update at a time, released when the script exits
mkdir -p "${LOCK%/*}"
exec 9> "$LOCK"

UPDATED=

case "$1" in
update)
  [ -n "$2" ] && [ -n "$3" ] || { echo "usage: $0 update <profile> <subscription>" >&2; exit 1; }
  # the page is told when another one runs
  flock -n 9 || { echo "$2/$3: another update is running"; exit $E_BUSY; }
  update "$2" "$3"
  code=$?
  reload_updated
  exit "$code"
  ;;
due)
  flock 9
  due
  ;;
*)
  echo "usage: $0 update <profile> <subscription>|due" >&2
  exit 1
  ;;
esac
