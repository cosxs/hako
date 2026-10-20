'use strict';
'require view';
'require openbox.ui as openbox';
'require form';
'require uci';
'require openbox.fields as fields';

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
// sing-box, and leaving detour empty already means direct; a hidden group,
// as Global, is the one of a mode
function detourChoices(option) {
  openbox.sectionChoices(option, 'outbound', _('Direct (default)'),
    (section) => section.type != 'direct' && section.hidden != '1');
}

function dependsOnTypes(option, types) {
  types.forEach((type) => option.depends('type', type));
}

// a choice for a value set by hand that is not among the others
function keepValue(option) {
  option.renderWidget = function (section_id, option_index, cfgvalue) {
    if (cfgvalue && !this.keylist.includes(cfgvalue))
      this.value(cfgvalue);

    return form.ListValue.prototype.renderWidget.apply(this, arguments);
  };
}

// the dial fields of an http client shown on their own: [ read from the
// JSON of the dial fields, write into it ]; the resolver may be an object
// with more than its server
const DIAL_OPTIONS = {
  _detour: [
    (dial) => dial.detour ?? '',
    (dial, value) => dial.detour = value || undefined
  ],
  _domain_resolver: [
    (dial) => (L.isObject(dial.domain_resolver) ? dial.domain_resolver.server : dial.domain_resolver) ?? '',
    (dial, value) => dial.domain_resolver = L.isObject(dial.domain_resolver)
      ? (value ? { ...dial.domain_resolver, server: value } : undefined)
      : (value || undefined)
  ]
};

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
    s.tab('http_client', _('HTTP clients'));
    s.tab('experimental', _('Experimental'));

    // log

    let o = s.taboption('log', form.ListValue, 'level', _('Level'));
    LEVELS.forEach((level) => o.value(level));
    o.default = 'warn';

    o = s.taboption('log', form.Flag, 'timestamp', _('Timestamp'));
    o.default = '1';
    o.rmempty = false;

    // dns

    // not local: while sing-box runs, dnsmasq sends its queries back to it,
    // and a query no rule matched would go round
    o = s.taboption('dns', form.ListValue, 'final', _('Default DNS server'));
    o.ucisection = 'dns';
    openbox.sectionChoices(o, 'dns_server', null, (section) => !(section.type in { fakeip: 1, local: 1 }));

    o = s.taboption('dns', form.ListValue, 'strategy', _('Resolve strategy'));
    o.ucisection = 'dns';
    o.value('', _('Default'));
    Object.keys(STRATEGIES).forEach((key) => o.value(key, STRATEGIES[key]));

    o = s.taboption('dns', form.Flag, 'optimistic', _('Optimistic cache'));
    o.ucisection = 'dns';
    o.default = '1';
    o.rmempty = false;

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
    so.validate = fields.validateRules;

    // ntp; options are named per tab and mapped to their UCI option, since
    // several objects share option names (enabled, path, ...)

    o = s.taboption('ntp', form.Flag, 'ntp_enabled', _('Enable'));
    o.ucisection = 'ntp';
    o.ucioption = 'enabled';
    o.rmempty = false;

    // the options below are kept while NTP is off
    o = s.taboption('ntp', form.Value, 'ntp_server', _('Server'));
    o.ucisection = 'ntp';
    o.ucioption = 'server';
    o.retain = true;
    o.placeholder = 'ntp.aliyun.com';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.Value, 'ntp_server_port', _('Port'));
    o.ucisection = 'ntp';
    o.ucioption = 'server_port';
    o.retain = true;
    o.datatype = 'port';
    o.default = '123';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.Value, 'ntp_interval', _('Sync interval'));
    o.ucisection = 'ntp';
    o.ucioption = 'interval';
    o.retain = true;
    openbox.duration(o, 'm', _('minutes'));
    o.default = '30';
    o.depends('ntp_enabled', '1');

    o = s.taboption('ntp', form.ListValue, 'ntp_detour', _('Outbound'));
    o.ucisection = 'ntp';
    o.ucioption = 'detour';
    o.retain = true;
    detourChoices(o);
    o.depends('ntp_enabled', '1');

    // http clients: how remote rule sets and Hysteria2 realms make their
    // requests, as the top-level http_clients of sing-box, with a dialog in
    // tabs as the one of a node

    o = s.taboption('http_client', form.SectionValue, '_http_clients', form.GridSection, 'http_client', _('HTTP clients'),
      _('Remote rule sets download with them, chosen as the default on the Route rules page or for each rule set.'));
    const hs = o.subsection;
    hs.anonymous = true;
    hs.addremove = true;
    hs.nodescriptions = true;
    hs.modaltitle = (section_id) => _('HTTP clients') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New HTTP client'));
    hs.tab('general', _('Basic'));
    hs.tab('http2', 'HTTP2');
    hs.tab('quic', 'QUIC');
    hs.tab('tls', 'TLS');
    hs.tab('dial', _('Dial'));

    so = hs.taboption('general', form.Value, 'tag', _('Tag'));
    so.rmempty = false;

    so = hs.taboption('general', form.ListValue, 'version', _('HTTP version'));
    [ '1', '2', '3' ].forEach((version) => so.value(version));
    so.default = '2';

    so = hs.taboption('general', form.Flag, 'disable_version_fallback', _('Disable version fallback'));
    so.modalonly = true;

    so = hs.taboption('general', form.DynamicList, 'headers', _('Headers'));
    so.placeholder = 'User-Agent: sing-box';
    so.validate = openbox.validateHeader;
    so.modalonly = true;

    // the QUIC fields of version 3 hold the HTTP2 fields of version 2: the
    // same options on both tabs, each kept while the other is shown
    so = hs.taboption('quic', form.Value, 'initial_packet_size', _('Initial packet size'));
    openbox.suffix(so, _('bytes'));
    so.datatype = 'uinteger';
    so.modalonly = true;
    so.depends('version', '3');

    so = hs.taboption('quic', form.Flag, 'disable_path_mtu_discovery', _('Disable path MTU discovery'));
    so.modalonly = true;
    so.depends('version', '3');

    for (const [tab, version] of [ [ 'http2', '2' ], [ 'quic', '3' ] ]) {
      const http2 = (name, title) => {
        const option = hs.taboption(tab, form.Value, `_${tab}_${name}`, title);
        option.ucioption = name;
        option.retain = true;
        option.modalonly = true;
        option.depends('version', version);
        return option;
      };

      openbox.duration(http2('idle_timeout', _('Idle timeout')), 's', _('seconds'));
      openbox.duration(http2('keep_alive_period', _('Keepalive period')), 's', _('seconds'));

      so = http2('stream_receive_window', _('Stream receive window'));
      so.placeholder = '6MB';
      so.validate = openbox.validateSize;

      so = http2('connection_receive_window', _('Connection receive window'));
      so.placeholder = '15MB';
      so.validate = openbox.validateSize;

      so = http2('max_concurrent_streams', _('Maximum concurrent streams'));
      so.datatype = 'uinteger';
    }

    fields.add(hs, 'tls', 'tls_fields', _('TLS fields'),
      _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box TLS fields</a>.')
        .format('https://sing-box.sagernet.org/configuration/shared/tls/#outbound'), {
        placeholder: JSON.stringify({ server_name: 'example.com', min_version: '1.2' }, null, 2)
      });

    // the dial fields used most, shown above the JSON of them all, by tag as
    // sing-box takes them; with a detour, sing-box ignores the others
    // also a column of the table
    so = hs.taboption('dial', form.ListValue, '_detour', _('Outbound'));
    so.value('', _('Direct (default)'));
    uci.sections(openbox.profileConfig(), 'outbound')
      .filter((section) => section.type != 'direct' && section.hidden != '1')
      .forEach((section) => so.value(openbox.label(section)));
    so.textvalue = function (section_id) {
      return '%h'.format(this.cfgvalue(section_id) || _('Direct (default)'));
    };
    keepValue(so);

    so = hs.taboption('dial', form.ListValue, '_domain_resolver', _('Domain resolver'));
    so.value('', _('Default'));
    uci.sections(openbox.profileConfig(), 'dns_server')
      .filter((section) => section.type != 'fakeip')
      .forEach((section) => so.value(openbox.label(section)));
    so.modalonly = true;
    so.depends('_detour', '');
    keepValue(so);

    fields.add(hs, 'dial', 'dial_fields', _('Dial fields'),
      _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box dial fields</a>.')
        .format('https://sing-box.sagernet.org/configuration/shared/dial/'), {
        placeholder: JSON.stringify({ detour: 'Proxy' }, null, 2),
        bind: DIAL_OPTIONS
      });

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
