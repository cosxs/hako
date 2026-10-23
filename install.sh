#!/bin/sh
# Install the latest Hako release.
#   wget -O - https://github.com/cosxs/hako/raw/main/install.sh | sh

set -e

REPO="cosxs/hako"

. /etc/openwrt_release

case "$DISTRIB_RELEASE" in
25.12*) ;;
*)
  echo "Hako requires OpenWrt 25.12, found $DISTRIB_RELEASE." >&2
  exit 1
  ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

TAR="hako_openwrt-25.12.tar.gz"
URL="https://github.com/$REPO/releases/latest/download/$TAR"

echo "Downloading Hako..."
wget -qO "$tmp/$TAR" "$URL"
wget -qO "$tmp/$TAR.sha256" "$URL.sha256"
# busybox sha256sum -c resolves names relative to the cwd
if ! (cd "$tmp" && sha256sum -c -s "$TAR.sha256"); then
  echo "Checksum verification failed." >&2
  exit 1
fi
tar -xzf "$tmp/$TAR" -C "$tmp"

pkgs="$tmp/hako-[0-9]*.apk $tmp/luci-app-hako-[0-9]*.apk"
for lang in $(apk info 2> /dev/null | sed -n 's/^luci-i18n-base-//p'); do
  pkgs="$pkgs $tmp/luci-i18n-hako-$lang-[0-9]*.apk"
done

apk update
# shellcheck disable=SC2046,SC2086
apk add --allow-untrusted $(ls $pkgs 2> /dev/null)

echo "Hako installed. Install the sing-box core from the Hako page in LuCI."
