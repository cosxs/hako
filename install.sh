#!/bin/sh
# Install the latest OpenBox release.
#   wget -O - https://github.com/cosxs/openbox/raw/main/install.sh | sh

set -e

REPO="cosxs/openbox"

. /etc/openwrt_release

case "$DISTRIB_RELEASE" in
25.12*) ;;
*)
	echo "OpenBox requires OpenWrt 25.12, found $DISTRIB_RELEASE." >&2
	exit 1
	;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading OpenBox..."
wget -qO "$tmp/openbox.tar.gz" "https://github.com/$REPO/releases/latest/download/openbox_openwrt-25.12.tar.gz"
tar -xzf "$tmp/openbox.tar.gz" -C "$tmp"

pkgs="$tmp/openbox-[0-9]*.apk $tmp/luci-app-openbox-[0-9]*.apk"
for lang in $(apk info 2> /dev/null | sed -n 's/^luci-i18n-base-//p'); do
	pkgs="$pkgs $tmp/luci-i18n-openbox-$lang-[0-9]*.apk"
done

apk update
# shellcheck disable=SC2046,SC2086
apk add --allow-untrusted $(ls $pkgs 2> /dev/null)

echo "OpenBox installed. Install the sing-box core from the OpenBox page in LuCI."
