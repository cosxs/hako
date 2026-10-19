'use strict';
'require view';
'require openbox.ui as openbox';
'require form';
'require uci';

const LEVELS = [ 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic' ];

const STRATEGIES = {
  prefer_ipv4: _('Prefer IPv4'),
  prefer_ipv6: _('Prefer IPv6'),
  ipv4_only: _('IPv4 only'),
  ipv6_only: _('IPv6 only')
};

// the dns server types, named as in the sing-box documentation
const DNS_TYPES = {
  tcp: 'TCP',
  udp: 'UDP',
  tls: 'TLS',
  quic: 'QUIC',
  https: 'HTTPS',
  h3: 'HTTP/3'
};
const REMOTE_DNS_TYPES = [ 'udp', 'tcp', 'tls', 'quic', 'https', 'h3' ];

// the placeholder of the custom DNS rules, like the examples of sing-box
const CUSTOM_RULES_EXAMPLE = JSON.stringify([
  {
    domain_suffix: [ 'nas.home' ],
    action: 'predefined',
    answer: [ 'nas.home. IN A 192.168.1.10' ]
  },
  {
    query_type: [ 'AAAA' ],
    action: 'predefined'
  },
  {
    type: 'logical',
    mode: 'or',
    rules: [
      { domain_suffix: [ 'corp.example.com' ] },
      { source_ip_cidr: [ '192.168.1.50/32' ] }
    ],
    action: 'route',
    server: 'local'
  }
], null, 2);

// outbounds a dial detour may use: a plain direct outbound is refused by
// sing-box, and leaving detour empty already means direct
function detourChoices(option) {
  option.value('', _('Direct (default)'));

  uci.sections(openbox.profileConfig(), 'outbound')
    .filter((section) => section.type != 'direct')
    .forEach((section) => option.value(section['.name'], openbox.label(section)));
}

function dependsOnTypes(option, types) {
  types.forEach((type) => option.depends('type', type));
}

return view.extend({
  load() {
    return openbox.loadProfile();
  },

  render() {
    // the profile in use; the clash API and the cache file are settings of
    // the device, in openbox
    const m = new form.Map(openbox.profileConfig());
    m.chain('openbox');

    // one section with a tab per sing-box object; each option is stored in
    // the UCI section that mirrors its object (log, dns, route, ...)
    const s = m.section(form.NamedSection, 'log', 'log');
    s.tab('log', _('Log'));
    s.tab('dns', _('DNS'));
    s.tab('ntp', 'NTP');
    s.tab('experimental', _('Experimental'));

    // log

    let o = s.taboption('log', form.ListValue, 'level', _('Level'));
    LEVELS.forEach((level) => o.value(level));
    o.default = 'warn';

    // find_neighbor: the MAC address and host name of LAN devices in the
    // log, from the neighbor table and the DHCP leases
    o = s.taboption('log', form.Flag, 'find_neighbor', _('Show devices'));
    o.ucisection = 'route';
    o.description = _('Logs connections with the MAC address and host name of the LAN device.');
    o.default = '1';
    o.rmempty = false;

    o = s.taboption('log', form.Flag, 'timestamp', _('Timestamp'));
    o.default = '1';
    o.rmempty = false;

    // dns

    o = s.taboption('dns', form.ListValue, 'final', _('Default DNS server'));
    o.ucisection = 'dns';
    openbox.resolverChoices(o);

    o = s.taboption('dns', form.ListValue, 'strategy', _('Resolve strategy'));
    o.ucisection = 'dns';
    o.value('', _('Default'));
    Object.keys(STRATEGIES).forEach((key) => o.value(key, STRATEGIES[key]));

    o = s.taboption('dns', form.Flag, 'optimistic', _('Optimistic cache'));
    o.ucisection = 'dns';
    o.default = '1';
    o.rmempty = false;

    o = s.taboption('dns', form.ListValue, 'default_domain_resolver', _('Node domain resolver'));
    o.ucisection = 'route';
    openbox.resolverChoices(o);

    o = s.taboption('dns', form.SectionValue, '_dns_servers', form.GridSection, 'dns_server', _('DNS servers'));
    const ss = o.subsection;
    // FakeIP is set on the Takeover page, with the DNS mode; local, the
    // system resolver, is built in for names of the LAN
    ss.filter = (section_id) => !(uci.get(openbox.profileConfig(), section_id, 'type') in { fakeip: 1, local: 1 });
    // added with a dialog, without a section name to type first
    ss.anonymous = true;
    ss.addremove = true;
    ss.sortable = true;
    ss.nodescriptions = true;
    ss.modaltitle = (section_id) => _('DNS servers') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New DNS server'));

    let so = ss.option(form.Value, 'tag', _('Tag'));
    so.rmempty = false;

    so = ss.option(form.ListValue, 'type', _('Type'));
    Object.keys(DNS_TYPES).forEach((type) => so.value(type, DNS_TYPES[type]));
    so.default = 'udp';
    so.textvalue = (section_id) => {
      const type = uci.get(openbox.profileConfig(), section_id, 'type');
      return DNS_TYPES[type] ?? '%h'.format(type ?? '');
    };

    so = ss.option(form.Value, 'server', _('Server'));
    dependsOnTypes(so, REMOTE_DNS_TYPES);

    so = ss.option(form.Value, 'server_port', _('Port'));
    so.datatype = 'port';
    so.modalonly = true;
    dependsOnTypes(so, REMOTE_DNS_TYPES);

    so = ss.option(form.Value, 'path', _('Path'));
    so.placeholder = '/dns-query';
    so.modalonly = true;
    dependsOnTypes(so, [ 'https', 'h3' ]);

    so = ss.option(form.Value, 'tls_server_name', _('TLS server name'));
    so.modalonly = true;
    dependsOnTypes(so, [ 'tls', 'quic', 'https', 'h3' ]);

    so = ss.option(form.ListValue, 'detour', _('Outbound'));
    so.modalonly = true;
    detourChoices(so);
    dependsOnTypes(so, REMOTE_DNS_TYPES);

    so = ss.option(form.ListValue, 'domain_resolver', _('Domain resolver'));
    so.modalonly = true;
    openbox.resolverChoices(so, _('Default'));
    dependsOnTypes(so, REMOTE_DNS_TYPES);

    // dns rules of sing-box written as JSON, put in front of the split
    // between mainland and foreign answers
    o = s.taboption('dns', form.SectionValue, '_dns_rules', form.NamedSection, 'dns', 'dns', _('DNS rules'),
      _('An array of <a href="%s" target="_blank" rel="noreferrer">sing-box DNS rules</a>, used as they are: after the names of the LAN, which go to dnsmasq, and before the split between mainland and foreign answers by the DNS mode. Servers and rule sets are named by their tags.')
        .format('https://sing-box.sagernet.org/configuration/dns/rule/'));

    so = o.subsection.option(form.TextValue, 'custom_rules');
    so.rows = 14;
    so.monospace = true;
    so.wrap = 'off';
    so.placeholder = CUSTOM_RULES_EXAMPLE;
    so.validate = (section_id, value) => {
      if (!value?.trim())
        return true;

      try {
        const rules = JSON.parse(value);
        const list = Array.isArray(rules) ? rules : [ rules ];

        return list.every((rule) => L.isObject(rule)) ? true : _('Expecting an array of rules');
      }
      catch (e) {
        return _('Invalid JSON: %s').format(e.message);
      }
    };

    // ntp; options are named per tab and mapped to their UCI option, since
    // several objects share option names (enabled, path, ...)

    o = s.taboption('ntp', form.Flag, 'ntp_enabled', _('Enable'));
    o.ucisection = 'ntp';
    o.ucioption = 'enabled';
    o.rmempty = false;

    o = s.taboption('ntp', form.Value, 'ntp_server', _('Server'));
    o.ucisection = 'ntp';
    o.ucioption = 'server';
    o.placeholder = 'ntp.aliyun.com';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.Value, 'ntp_server_port', _('Port'));
    o.ucisection = 'ntp';
    o.ucioption = 'server_port';
    o.datatype = 'port';
    o.default = '123';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.Value, 'ntp_interval', _('Sync interval'));
    o.ucisection = 'ntp';
    o.ucioption = 'interval';
    openbox.duration(o, 'm', _('minutes'));
    o.default = '30';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.ListValue, 'ntp_detour', _('Outbound'));
    o.ucisection = 'ntp';
    o.ucioption = 'detour';
    detourChoices(o);
    o.depends('ntp_enabled', '1');

    // experimental

    o = s.taboption('experimental', form.Value, 'clash_external_controller', _('Clash API listen address'));
    o.uciconfig = 'openbox';
    o.ucisection = 'clash_api';
    o.ucioption = 'external_controller';
    o.datatype = 'ipaddrport(1)';
    o.placeholder = '127.0.0.1:9090';

    o = s.taboption('experimental', form.Value, 'clash_secret', _('Clash API secret'));
    o.uciconfig = 'openbox';
    o.ucisection = 'clash_api';
    o.ucioption = 'secret';
    o.password = true;

    o = s.taboption('experimental', form.Flag, 'cache_enabled', _('Cache file'));
    o.uciconfig = 'openbox';
    o.ucisection = 'cache_file';
    o.ucioption = 'enabled';
    o.default = '1';
    o.rmempty = false;

    o = s.taboption('experimental', form.Value, 'cache_path', _('Cache file path'));
    o.uciconfig = 'openbox';
    o.ucisection = 'cache_file';
    o.ucioption = 'path';
    o.placeholder = '/etc/openbox/cache.db';
    o.depends('cache_enabled', '1');

    return m.render().then((node) => E([], [ ...openbox.header(), node ]));
  }
});
