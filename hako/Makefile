include $(TOPDIR)/rules.mk

PKG_NAME:=hako
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-3.0-only
PKG_MAINTAINER:=cosxs

include $(INCLUDE_DIR)/package.mk

define Package/hako
  SECTION:=net
  CATEGORY:=Network
  TITLE:=A minimal sing-box client for OpenWrt
  URL:=https://github.com/cosxs/hako
  DEPENDS:=firewall4 +ip-full +kmod-tun +kmod-nft-tproxy +kmod-inet-diag +kmod-nft-queue +ca-bundle +jsonfilter +uclient-fetch +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-socket +ucode-mod-ubus
  PKGARCH:=all
endef

define Package/hako/description
  Run sing-box with a configuration generated from the profile in use, and
  route traffic through it.
endef

define Package/hako/conffiles
/etc/config/hako
endef

define Build/Compile
endef

define Package/hako/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/hako.conf $(1)/etc/config/hako

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/hako.init $(1)/etc/init.d/hako

	$(INSTALL_DIR) $(1)/etc/hotplug.d/iface
	$(INSTALL_DATA) ./files/hako.hotplug $(1)/etc/hotplug.d/iface/90-hako

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/hako.uci-defaults $(1)/etc/uci-defaults/90-hako

	$(INSTALL_DIR) $(1)/etc/hako

	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/hako.upgrade $(1)/lib/upgrade/keep.d/hako

	$(INSTALL_DIR) $(1)/usr/share/hako
	$(INSTALL_DATA) ./files/common.sh $(1)/usr/share/hako/common.sh
	# the template of a new profile, copied to /etc/config/hako_<name>
	$(INSTALL_DIR) $(1)/usr/share/hako/template
	$(INSTALL_DATA) ./files/template/hako_template $(1)/usr/share/hako/template/hako_template
	$(INSTALL_BIN) ./files/core-install.sh $(1)/usr/share/hako/core-install.sh
	$(INSTALL_BIN) ./files/run.sh $(1)/usr/share/hako/run.sh
	$(INSTALL_BIN) ./files/subscription.sh $(1)/usr/share/hako/subscription.sh

	$(INSTALL_DIR) $(1)/usr/share/hako/ucode
	$(INSTALL_DATA) ./files/ucode/generate.uc $(1)/usr/share/hako/ucode/generate.uc
	$(INSTALL_DATA) ./files/ucode/firewall.uc $(1)/usr/share/hako/ucode/firewall.uc
	$(INSTALL_DATA) ./files/ucode/migrate.uc $(1)/usr/share/hako/ucode/migrate.uc
	$(INSTALL_DATA) ./files/ucode/mode.uc $(1)/usr/share/hako/ucode/mode.uc
	$(INSTALL_DATA) ./files/ucode/inspect.uc $(1)/usr/share/hako/ucode/inspect.uc

	# modules shared with luci-app-hako: import ... from 'hako.clash'
	$(INSTALL_DIR) $(1)/usr/share/ucode/hako
	$(INSTALL_DATA) ./files/ucode/clash.uc $(1)/usr/share/ucode/hako/clash.uc
	$(INSTALL_DATA) ./files/ucode/config.uc $(1)/usr/share/ucode/hako/config.uc
	$(INSTALL_DATA) ./files/ucode/profile.uc $(1)/usr/share/ucode/hako/profile.uc

	# the IP list of mainland China from SagerNet/sing-geoip, the latest when
	# built: the initial_path of the geoip-cn rule set, which sing-box uses
	# until it has downloaded and cached one of its own
	$(INSTALL_DIR) $(1)/usr/share/hako/rule-set
	$(INSTALL_DATA) ./files/rule-set/geoip-cn.srs $(1)/usr/share/hako/rule-set/geoip-cn.srs
	echo "$(PKG_VERSION)-r$(PKG_RELEASE)" > $(1)/usr/share/hako/version
endef

$(eval $(call BuildPackage,hako))
