'use strict';
'require view';
'require hako.ui as hako';
'require form';
'require uci';
'require tools.widgets as widgets';

// the IPv6 address of the tun for the IPv6 takeover, as in the examples of
// sing-box
const TUN_IPV6 = 'fdfe:dcba:9876::1/126';

// options of a mode keep their values while another mode is selected
function modeOption(option, mode) {
  option.depends('_mode', mode);
  option.retain = true;

  return option;
}

return view.extend({
  load() {
    return hako.loadProfile();
  },

  render() {
    // the takeover is a setting of the device; the DNS mode, the FakeIP
    // ranges and the DNS strategy belong to the profile in use
    const profile = hako.profileConfig();
    const m = new form.Map('hako');
    m.chain(profile);

    const s = m.section(form.NamedSection, 'tun', 'inbound', null,
      _('Takes over the traffic of LAN devices and of the router itself with TUN or TProxy. DNS queries are answered by sing-box; local names still go to dnsmasq.'));

    // the takeover is the enabled tun or tproxy inbound, together with
    // the dns inbound
    const enabled = s.option(form.Flag, '_enabled', _('Enable'));
    const mode = s.option(form.ListValue, '_mode', _('Takeover mode'));

    const apply = (section_id) => {
      const on = enabled.formvalue(section_id) == '1';
      const tproxy = mode.formvalue(section_id) == 'tproxy';

      uci.set('hako', 'tun', 'enabled', (on && !tproxy) ? '1' : '0');
      uci.set('hako', 'tproxy', 'enabled', (on && tproxy) ? '1' : '0');
      uci.set('hako', 'dns_in', 'enabled', on ? '1' : '0');
    };

    enabled.rmempty = false;
    enabled.forcewrite = true;
    enabled.cfgvalue = () => (uci.get('hako', 'tun', 'enabled') == '1' || uci.get('hako', 'tproxy', 'enabled') == '1') ? '1' : '0';
    enabled.write = enabled.remove = apply;

    mode.value('tun', 'TUN');
    mode.value('tproxy', 'TProxy');
    mode.description = _('TUN is set up by sing-box itself. TProxy uses firewall rules set up by Hako and handles TCP and UDP in the kernel.');
    mode.forcewrite = true;
    mode.cfgvalue = () => (uci.get('hako', 'tproxy', 'enabled') == '1') ? 'tproxy' : 'tun';
    mode.write = mode.remove = apply;

    // FakeIP or RealIP for addresses outside the mainland: the dns server
    // of the "foreign" and "fallback" dns rules; fake addresses are
    // answered with a TTL of 1 second, so devices hardly cache them and
    // get real ones as soon as Hako stops
    const modeRules = [ 'foreign', 'fallback' ].filter((name) => uci.get(profile, name));
    // RealIP resolves foreign domains with a server added by hand, one
    // through the proxy as a rule: not local, whose answers come from the
    // ISP and may be polluted
    const realips = uci.sections(profile, 'dns_server').filter((section) => !(section.type in { fakeip: 1, local: 1 }));

    let o = s.option(form.ListValue, '_dns_mode', _('DNS mode'));
    o.value('fakeip', _('FakeIP'));
    realips.forEach((section) => o.value(section['.name'], _('RealIP') + ' · ' + (section.tag || section['.name'])));
    o.description = _('FakeIP answers foreign domains at once and lets the node resolve them. RealIP resolves them through the proxy first: slower on the first visit, but works with every app.');
    if (!realips.length)
      o.description += ' ' + _('RealIP needs a DNS server added under Core settings › DNS first.');
    o.cfgvalue = () => uci.get(profile, 'foreign', 'server');
    o.write = (section_id, value) => modeRules.forEach((name) => {
      uci.set(profile, name, 'server', value);
      uci.set(profile, name, 'rewrite_ttl', (value == 'fakeip') ? '1' : null);
    });
    o.remove = () => {};

    // keep a server set by hand selectable
    const current = uci.get(profile, 'foreign', 'server');
    if (current && current != 'fakeip' && !realips.some((section) => section['.name'] == current))
      o.value(current, current);

    if (!modeRules.length)
      o.readonly = true;

    // the address ranges FakeIP answers from
    if (uci.get(profile, 'fakeip')) {
      o = s.option(form.Value, '_fakeip_inet4', _('FakeIP IPv4 range'));
      o.uciconfig = profile;
      o.ucisection = 'fakeip';
      o.ucioption = 'inet4_range';
      o.datatype = 'cidr4';
      o.placeholder = '198.18.0.0/15';
      o.retain = true;
      o.depends('_dns_mode', 'fakeip');

      o = s.option(form.Value, '_fakeip_inet6', _('FakeIP IPv6 range'));
      o.uciconfig = profile;
      o.ucisection = 'fakeip';
      o.ucioption = 'inet6_range';
      o.datatype = 'cidr6';
      o.placeholder = '2001:2::/48';
      o.description = _('Used with the IPv6 takeover on.');
      o.retain = true;
      o.depends('_dns_mode', 'fakeip');
    }

    // IPv6: the tun gets an IPv6 address, which makes sing-box route
    // IPv6 as well; the tproxy firewall takes it over; DNS answers IPv6
    // addresses. Off, only IPv4 is taken over and resolved
    const ipv6 = s.option(form.Flag, '_ipv6', _('IPv6'));
    ipv6.description = _('Takes over IPv6 as well, and DNS answers IPv6 addresses. Mainland IPv6 addresses stay direct. With RealIP the nodes need to reach IPv6 addresses; with FakeIP they resolve the domains themselves.');
    ipv6.rmempty = false;
    ipv6.forcewrite = true;
    ipv6.cfgvalue = () => (uci.get('hako', 'firewall', 'ipv6') == '1') ? '1' : '0';
    ipv6.write = ipv6.remove = (section_id) => {
      const on = ipv6.formvalue(section_id) == '1';
      const addresses = L.toArray(uci.get('hako', 'tun', 'address'));
      const v4 = addresses.filter((address) => address.indexOf(':') < 0);
      const v6 = addresses.filter((address) => address.indexOf(':') >= 0);

      uci.set('hako', 'firewall', 'ipv6', on ? '1' : '0');
      uci.set(profile, 'dns', 'strategy', on ? 'prefer_ipv4' : 'ipv4_only');
      uci.set('hako', 'tun', 'address', on ? [ ...v4, ...(v6.length ? v6 : [ TUN_IPV6 ]) ] : v4);
    };

    // the dns inbound: the firewall redirects the DNS of the LAN and of the
    // router here while sing-box runs
    o = s.option(form.Value, '_dns_port', _('DNS port'));
    o.ucisection = 'dns_in';
    o.ucioption = 'listen_port';
    o.datatype = 'port';
    o.placeholder = '1053';
    o.rmempty = false;
    o.retain = true;
    o.description = _('While Hako runs, the DNS queries of LAN devices and of the router itself are redirected to this port of sing-box.');

    // tun

    o = modeOption(s.option(form.Value, 'interface_name', _('Interface name')), 'tun');
    o.datatype = 'maxlength(15)';
    o.placeholder = 'hako-tun';
    o.rmempty = false;

    o = modeOption(s.option(form.DynamicList, 'address', _('Address')), 'tun');
    o.datatype = 'cidr';
    o.placeholder = '172.19.0.1/30';

    o = modeOption(s.option(form.Value, 'mtu', _('MTU')), 'tun');
    o.datatype = 'range(1280,65535)';
    o.placeholder = '9000';

    o = modeOption(s.option(form.MultiValue, 'route_exclude_address_set', _('Bypass rule sets')), 'tun');
    o.description = _('Destinations in these rule sets bypass sing-box in the firewall.');
    hako.sectionChoices(o, 'rule_set');

    // sing-box takes both families in one list: shown split, saved merged
    const excludeList = (family, title) => {
      const option = modeOption(s.option(form.DynamicList, '_tun_exclude' + family, title), 'tun');
      const ofFamily = (address) => (address.indexOf(':') >= 0) == (family == 6);
      const current = () => L.toArray(uci.get('hako', 'tun', 'route_exclude_address'));
      const others = () => current().filter((address) => !ofFamily(address));

      option.datatype = (family == 6) ? 'cidr6' : 'cidr4';
      option.cfgvalue = () => current().filter(ofFamily);
      option.write = (section_id, value) => uci.set('hako', 'tun', 'route_exclude_address',
        (family == 4) ? [ ...L.toArray(value), ...others() ] : [ ...others(), ...L.toArray(value) ]);
      option.remove = () => others().length
        ? uci.set('hako', 'tun', 'route_exclude_address', others())
        : uci.unset('hako', 'tun', 'route_exclude_address');

      return option;
    };

    excludeList(4, _('Bypass IPv4 addresses'));

    // sing-box leaves IPv6 alone unless the tun has an IPv6 address
    o = excludeList(6, _('Bypass IPv6 addresses'));
    o.description = _('Used with the IPv6 takeover on.');

    // tproxy: the inbounds, and the firewall Hako sets up for them

    o = modeOption(s.option(form.Value, '_tproxy_port', _('TProxy port')), 'tproxy');
    o.ucisection = 'tproxy';
    o.ucioption = 'listen_port';
    o.datatype = 'port';
    o.placeholder = '7893';
    o.rmempty = false;

    o = modeOption(s.option(widgets.NetworkSelect, '_lan', _('LAN interfaces')), 'tproxy');
    o.ucisection = 'firewall';
    o.ucioption = 'interface';
    o.multiple = true;
    o.nocreate = true;
    o.description = _('Traffic coming in on these interfaces is taken over.');

    o = modeOption(s.option(form.DynamicList, '_bypass_address', _('Bypass IPv4 addresses')), 'tproxy');
    o.ucisection = 'firewall';
    o.ucioption = 'bypass_address';
    o.datatype = 'cidr4';

    // without the IPv6 takeover, IPv6 to anything else is refused
    o = modeOption(s.option(form.DynamicList, '_bypass_address6', _('Bypass IPv6 addresses')), 'tproxy');
    o.ucisection = 'firewall';
    o.ucioption = 'bypass_address6';
    o.datatype = 'cidr6';
    o.description = _('With the IPv6 takeover off, IPv6 TCP and UDP connections to other addresses are refused, so clients fall back to IPv4.');

    // a proxy port for devices set up by hand, on or off apart from the
    // takeover; the WAN zone of the firewall keeps it closed from outside
    if (uci.get('hako', 'mixed')) {
      const mixed = m.section(form.NamedSection, 'mixed', 'inbound', _('Proxy port'),
        _('LAN devices can use the router as an HTTP or SOCKS5 proxy at this port, with or without the takeover.'));

      o = mixed.option(form.Flag, 'enabled', _('Enable'));
      o.rmempty = false;

      o = mixed.option(form.Value, 'listen_port', _('Port'));
      o.datatype = 'port';
      o.placeholder = '7890';
      o.rmempty = false;

      o = mixed.option(form.Value, 'username', _('Username'));
      o.description = _('Leave empty to use the proxy without a password.');

      o = mixed.option(form.Value, 'password', _('Password'));
      o.password = true;
      o.rmempty = false;
      o.depends({ username: /./ });
    }

    return m.render().then((node) => E([], [ ...hako.header(), node ]));
  }
});
