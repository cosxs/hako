#!/bin/sh
# Remove Hako together with its config, profiles and logs. The sing-box core is kept.
#   wget -O - https://github.com/cosxs/hako/raw/main/uninstall.sh | sh

# shellcheck disable=SC2046
apk del $(apk info 2> /dev/null | grep '^luci-i18n-hako-') luci-app-hako hako

rm -rf /etc/config/hako /etc/config/hako_* /etc/hako /var/run/hako /var/log/hako

echo "Hako removed."
