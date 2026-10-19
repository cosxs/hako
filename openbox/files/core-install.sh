#!/bin/sh
# Install the sing-box core from the latest GitHub release or from an uploaded apk.
#   core-install.sh latest          print the latest release for this device as JSON
#   core-install.sh github          download and install the latest release
#   core-install.sh upload <file>   install an uploaded apk

. /usr/share/openbox/common.sh
. /etc/openwrt_release

REPO="SagerNet/sing-box"
DOWNLOAD="/tmp/openbox-core.apk"

fail() {
  echo "Error: $*"
  exit 1
}

# sets VERSION, URL and SIZE for this device's package in the latest release
resolve_latest() {
  local release name

  release=$(uclient-fetch -q -O - "https://api.github.com/repos/$REPO/releases/latest") ||
    fail "unable to query the latest release from GitHub"

  VERSION=$(printf "%s" "$release" | jsonfilter -e '@.tag_name')
  VERSION=${VERSION#v}
  name="sing-box_${VERSION}_openwrt_${DISTRIB_ARCH}.apk"
  URL=$(printf "%s" "$release" | jsonfilter -e "@.assets[@.name='$name'].browser_download_url")
  SIZE=$(printf "%s" "$release" | jsonfilter -e "@.assets[@.name='$name'].size")

  [ -n "$URL" ] || fail "no package for $DISTRIB_ARCH in sing-box $VERSION"
}

free_space() {
  { df -k /overlay 2> /dev/null || df -k /; } | awk 'END { print $4 * 1024 }'
}

install_apk() {
  local file="$1" info name version size

  info=$(apk adbdump "$file" 2> /dev/null) || fail "not a valid apk package"
  name=$(echo "$info" | sed -n 's/^  name: //p' | head -n 1)
  version=$(echo "$info" | sed -n 's/^  version: //p' | head -n 1)
  size=$(echo "$info" | sed -n 's/^  installed-size: //p' | head -n 1)

  [ "$name" = "sing-box" ] || fail "the package is '$name', not sing-box"
  version_ge "${version%-r*}" "$CORE_MIN_VERSION" ||
    fail "sing-box $version is too old, $CORE_MIN_VERSION or later is required"
  [ "${size:-0}" -lt "$(free_space)" ] ||
    fail "not enough free space: $((size / 1048576)) MB required"

  echo "Installing sing-box $version"

  # sing-box-tiny from the OpenWrt feeds conflicts with the sing-box package
  if apk info -e sing-box-tiny > /dev/null; then
    apk del sing-box-tiny || fail "unable to remove sing-box-tiny"
  fi

  apk add --allow-untrusted "$file" || fail "apk add failed"

  core_service_off

  if /etc/init.d/openbox running; then
    echo "Restarting OpenBox"
    /etc/init.d/openbox restart
  fi

  echo "sing-box $(core_version) installed"
}

case "$1" in
latest)
  resolve_latest
  printf '{"version":"%s","arch":"%s","size":%s,"free_space":%s}\n' \
    "$VERSION" "$DISTRIB_ARCH" "${SIZE:-0}" "$(free_space)"
  ;;
github)
  resolve_latest
  echo "Downloading sing-box $VERSION for $DISTRIB_ARCH"
  trap 'rm -f "$DOWNLOAD"' EXIT
  uclient-fetch -q -O "$DOWNLOAD" "$URL" || fail "download failed"
  install_apk "$DOWNLOAD"
  ;;
upload)
  [ -f "$2" ] || fail "uploaded file not found"
  trap 'rm -f "$2"' EXIT
  install_apk "$2"
  ;;
*)
  echo "usage: $0 latest|github|upload <file>" >&2
  exit 1
  ;;
esac
