#!/bin/sh
# Subscriptions: profiles downloaded from a URL that returns a full sing-box
# JSON config, kept in config subscription sections of /etc/config/openbox.
#   subscription.sh update <file>   download the subscription of a profile
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

# the section of the subscription of a profile, in SECTION
find_section() {
	SECTION=
	config_load openbox
	config_foreach match_file subscription "$1"
}

match_file() {
	local file

	config_get file "$1" file
	[ "$file" = "$2" ] && SECTION="$1"
}

record_error() {
	uci set "openbox.$1.last_error=$2"
	uci commit openbox
}

valid_json() {
	ucode -e 'import { readfile } from "fs";
		try { exit(type(json(readfile(ARGV[0]) ?? "")) == "object" ? 0 : 1); } catch (e) { exit(1); }' "$1" 2> /dev/null
}

# update <file>: download, check and replace the profile; a running service
# using it is reloaded. Fails without touching the profile.
update() {
	local file="$1" url temp msg target="$PROFILE_DIR/$1" changed=1

	case "$file" in
	'' | .* | */*) say "invalid file name: $file"; return $E_NOT_FOUND ;;
	esac

	find_section "$file"
	if [ -z "$SECTION" ]; then
		say "$file: no subscription"
		return $E_NOT_FOUND
	fi

	config_get url "$SECTION" url
	mkdir -p "$RUN_DIR"
	temp=$(mktemp -d /tmp/openbox-sub.XXXXXX) || return $E_WRITE

	# not quiet: its last line tells why it failed, like "HTTP error 404"
	if ! uclient-fetch -T "${FETCH_TIMEOUT:-30}" -O "$temp/download.json" \
		--user-agent "$(user_agent)" "$url" > "$temp/fetch.log" 2>&1; then
		msg=$(grep -v '^$' "$temp/fetch.log" | tail -n 1)
		rm -rf "$temp"
		record_error "$SECTION" "download failed${msg:+: $msg}"
		say "$file: download failed${msg:+: $msg}"
		return $E_DOWNLOAD
	fi

	if ! valid_json "$temp/download.json"; then
		rm -rf "$temp"
		record_error "$SECTION" "not a JSON config"
		say "$file: the download is not a JSON config"
		return $E_JSON
	fi

	if [ -x "$CORE" ] &&
	   ! "$CORE" check -c "$temp/download.json" -D "$RUN_DIR" > "$temp/check.log" 2>&1; then
		msg=$(sed 's/\x1b\[[0-9;]*m//g' "$temp/check.log" | grep -v '^$' | tail -n 1)
		rm -rf "$temp"
		record_error "$SECTION" "sing-box check failed${msg:+: $msg}"
		say "$file: sing-box check failed${msg:+: $msg}"
		return $E_CHECK
	fi

	if cmp -s "$temp/download.json" "$target"; then
		changed=
	else
		# copied next to the profile first, so the rename replaces it at once
		mkdir -p "$PROFILE_DIR"
		if ! cp -f "$temp/download.json" "$PROFILE_DIR/.$file.new" ||
		   ! mv -f "$PROFILE_DIR/.$file.new" "$target"; then
			rm -rf "$temp" "$PROFILE_DIR/.$file.new"
			record_error "$SECTION" "unable to write the profile"
			say "$file: unable to write the profile"
			return $E_WRITE
		fi
	fi
	rm -rf "$temp"

	uci set "openbox.$SECTION.last_update=$(date +%s)"
	uci -q delete "openbox.$SECTION.last_error"
	uci commit openbox

	if [ -z "$changed" ]; then
		say "$file: unchanged"
	elif [ "$(uci -q get openbox.main.source)" = profile ] &&
	     [ "$(uci -q get openbox.main.profile)" = "$file" ] &&
	     /etc/init.d/openbox running; then
		/etc/init.d/openbox reload 9>&-
		say "$file: updated, OpenBox reloaded"
	else
		say "$file: updated"
	fi
}

due_one() {
	local file interval seconds last

	config_get file "$1" file
	config_get interval "$1" update_interval
	config_get last "$1" last_update 0

	[ -n "$file" ] && [ -n "$interval" ] || return 0

	if ! seconds=$(duration_seconds "$interval"); then
		say "$file: invalid update interval: $interval"
		return 0
	fi
	[ "$seconds" -gt 0 ] || return 0

	case "$last" in
	'' | *[!0-9]*) last=0 ;;
	esac
	[ $(($(date +%s) - last + DUE_SLACK)) -ge "$seconds" ] || return 0

	# each update loads the config again, so collect the files first
	DUE_FILES="$DUE_FILES $file"
}

due() {
	local file

	DUE_FILES=
	config_load openbox
	config_foreach due_one subscription

	for file in $DUE_FILES; do
		update "$file"
	done

	return 0
}

# one update at a time, released when the script exits
mkdir -p "${LOCK%/*}"
exec 9> "$LOCK"

case "$1" in
update)
	[ -n "$2" ] || { echo "usage: $0 update <file>" >&2; exit 1; }
	# the page is told when another one runs
	flock -n 9 || { echo "$2: another update is running"; exit $E_BUSY; }
	update "$2"
	;;
due)
	flock 9
	due
	;;
*)
	echo "usage: $0 update <file>|due" >&2
	exit 1
	;;
esac
