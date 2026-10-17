#!/bin/sh
# Regression tests of the config generator and the migration.
#
# Usage: tests/run.sh [--update] [case...]
#
# Each directory in tests/cases holds a UCI file named openbox. A case named
# migrate-* runs migrate.uc on it and compares the result with "expected";
# any other runs generate.uc and compares the JSON with "expected.json".
# Either way the generated config has to pass "sing-box check".
# --update writes the expected files from the current output instead.
#
# UCODE and SING_BOX override the commands, which default to the ones in PATH.

UCODE=${UCODE:-ucode}
SING_BOX=${SING_BOX:-sing-box}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CASES="$ROOT/tests/cases"
SCRIPTS="$ROOT/openbox/files/ucode"

update=0
if [ "$1" = "--update" ]; then
	update=1
	shift
fi

for command in "$UCODE" "$SING_BOX"; do
	if ! command -v "$command" > /dev/null 2>&1; then
		echo "run.sh: $command not found" >&2
		exit 2
	fi
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# JSON with sorted keys, so the order of fields does not matter
normalize() {
	"$UCODE" -e '
		const fs = require("fs");
		function sorted(value) {
			if (type(value) == "array")
				return map(value, sorted);
			if (type(value) != "object")
				return value;
			const result = {};
			for (let key in sort(keys(value)))
				result[key] = sorted(value[key]);
			return result;
		}
		printf("%.J\n", sorted(json(fs.readfile(ARGV[0]))));
	' "$1"
}

show_diff() {
	if command -v diff > /dev/null 2>&1; then
		diff -u "$1" "$2"
	else
		cmp "$1" "$2"
	fi
}

# run a script of OpenBox on the UCI files in a directory, with its own
# directory for uncommitted changes
openbox() {
	OPENBOX_CONFDIR="$1" OPENBOX_SAVEDIR="$1/.uci" "$UCODE" "$SCRIPTS/$2"
}

# generate the config of a UCI directory into a file and check it
generate() {
	if ! openbox "$1" generate.uc > "$2" 2> "$2.err"; then
		cat "$2.err" >&2
		return 1
	fi

	# warnings are not failures, but worth seeing
	if [ -s "$2.err" ]; then
		sed 's/^/  /' "$2.err" >&2
	fi

	# sing-box reads the local rule sets, which may not be installed
	rm -rf "$TMP/sing-box"
	mkdir -p "$TMP/sing-box"
	sed "s|\"/usr/share/openbox/rule-set/|\"$ROOT/openbox/files/rule-set/|" "$2" > "$TMP/sing-box/config.json"
	"$SING_BOX" check -c "$TMP/sing-box/config.json" -D "$TMP/sing-box"
}

run_generate() {
	dir="$CASES/$1"
	out="$TMP/$1.json"

	generate "$dir" "$out" || return 1

	if [ "$update" = 1 ]; then
		cp "$out" "$dir/expected.json"
		return 0
	fi

	[ -f "$dir/expected.json" ] || { echo "  no expected.json" >&2; return 1; }
	normalize "$dir/expected.json" > "$TMP/expected.norm" &&
		normalize "$out" > "$TMP/actual.norm" || return 1
	cmp -s "$TMP/expected.norm" "$TMP/actual.norm" ||
		{ show_diff "$TMP/expected.norm" "$TMP/actual.norm" >&2; return 1; }
}

run_migrate() {
	dir="$CASES/$1"
	conf="$TMP/$1"

	rm -rf "$conf"
	mkdir -p "$conf/.uci"
	cp "$dir/openbox" "$conf/openbox"
	openbox "$conf" migrate.uc || return 1

	if [ "$update" = 1 ]; then
		cp "$conf/openbox" "$dir/expected"
	else
		[ -f "$dir/expected" ] || { echo "  no expected" >&2; return 1; }
		cmp -s "$dir/expected" "$conf/openbox" ||
			{ show_diff "$dir/expected" "$conf/openbox" >&2; return 1; }
	fi

	# the migrated config still makes a valid sing-box config
	generate "$conf" "$TMP/$1.json"
}

if [ $# = 0 ]; then
	for dir in "$CASES"/*/; do
		dir=${dir%/}
		set -- "$@" "${dir##*/}"
	done
fi

failed=0
for name in "$@"; do
	if [ ! -f "$CASES/$name/openbox" ]; then
		echo "FAIL $name: no such case"
		failed=$((failed + 1))
		continue
	fi

	case "$name" in
		migrate-*) test=run_migrate ;;
		*) test=run_generate ;;
	esac

	if "$test" "$name"; then
		echo "ok   $name"
	else
		echo "FAIL $name"
		failed=$((failed + 1))
	fi
done

if [ "$failed" != 0 ]; then
	echo "$failed failed"
	exit 1
fi
