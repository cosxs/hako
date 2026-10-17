#!/bin/sh
# Remove OpenBox together with its config, profiles and logs. The sing-box core is kept.
#   wget -O - https://github.com/cosxs/openbox/raw/main/uninstall.sh | sh

# shellcheck disable=SC2046
apk del $(apk info 2> /dev/null | grep '^luci-i18n-openbox-') luci-app-openbox openbox

rm -rf /etc/config/openbox /etc/openbox /var/run/openbox /var/log/openbox

echo "OpenBox removed."
