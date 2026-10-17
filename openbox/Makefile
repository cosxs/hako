include $(TOPDIR)/rules.mk

PKG_NAME:=openbox
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-3.0-only
PKG_MAINTAINER:=cosxs

include $(INCLUDE_DIR)/package.mk

define Package/openbox
  SECTION:=net
  CATEGORY:=Network
  TITLE:=A minimal sing-box client for OpenWrt
  URL:=https://github.com/cosxs/openbox
  DEPENDS:=firewall4 +ip-full +kmod-tun +kmod-nft-tproxy +kmod-inet-diag +kmod-nft-queue +ca-bundle +jsonfilter +uclient-fetch +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-socket +ucode-mod-ubus
  PKGARCH:=all
endef

define Package/openbox/description
  Run sing-box with a configuration generated from UCI, or with a native
  JSON profile, and route traffic through it.
endef

define Package/openbox/conffiles
/etc/config/openbox
endef

define Build/Compile
endef

define Package/openbox/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/openbox.conf $(1)/etc/config/openbox

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/openbox.init $(1)/etc/init.d/openbox

	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_DATA) ./files/openbox.hotplug $(1)/etc/hotplug.d/iface/90-openbox

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/openbox.uci-defaults $(1)/etc/uci-defaults/90-openbox

	$(INSTALL_DIR) $(1)/etc/openbox/profiles

	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/openbox.upgrade $(1)/lib/upgrade/keep.d/openbox

	$(INSTALL_DIR) $(1)/usr/share/openbox
	$(INSTALL_DATA) ./files/common.sh $(1)/usr/share/openbox/common.sh
	$(INSTALL_BIN) ./files/core-install.sh $(1)/usr/share/openbox/core-install.sh
	$(INSTALL_BIN) ./files/run.sh $(1)/usr/share/openbox/run.sh

	$(INSTALL_DIR) $(1)/usr/share/openbox/ucode
	$(INSTALL_DATA) ./files/ucode/generate.uc $(1)/usr/share/openbox/ucode/generate.uc
	$(INSTALL_DATA) ./files/ucode/firewall.uc $(1)/usr/share/openbox/ucode/firewall.uc
	$(INSTALL_DATA) ./files/ucode/migrate.uc $(1)/usr/share/openbox/ucode/migrate.uc
	$(INSTALL_DATA) ./files/ucode/mode.uc $(1)/usr/share/openbox/ucode/mode.uc

	# the mainland China IP list from cosxs/cn-mainland-ip, so the bypass works
	# without downloading anything at start
	$(INSTALL_DIR) $(1)/usr/share/openbox/rule-set
	$(INSTALL_DATA) ./files/rule-set/cn-mainland-ip.srs $(1)/usr/share/openbox/rule-set/cn-mainland-ip.srs
	echo "$(PKG_VERSION)-r$(PKG_RELEASE)" > $(1)/usr/share/openbox/version
endef

$(eval $(call BuildPackage,openbox))
