'use strict';
'require view';
'require hako.ui as hako';
'require form';
'require uci';
'require hako.fields as fields';

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
  hako.sectionChoices(option, 'outbound', _('Direct (default)'),
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
    return hako.loadProfile();
  },

  render() {
    // the profile in use; the experimental settings are of the device, in
    // hako
    const m = new form.Map(hako.profileConfig());
    m.chain('hako');

    // one section with a tab per sing-box object; each option is stored in
    // the UCI section that mirrors its object (log, dns, route, ...)
    const s = m.section(form.NamedSection, 'log', 'log');
    s.tab('log', _('Log'));
    s.tab('dns', _('DNS'));
    s.tab('ntp', 'NTP');
    s.tab('http_client', _('HTTP clients'));
    s.tab('api', 'API');
    s.tab('experimental', _('Experimental'));

    // log

    let o = s.taboption('log', form.Flag, 'disabled', _('Disable'));
    o.description = _('sing-box writes no log once it has started, and the Logs page shows none of it.');

    // kept while the log is off
    o = s.taboption('log', form.ListValue, 'level', _('Level'));
    LEVELS.forEach((level) => o.value(level));
    o.default = 'warn';
    o.retain = true;
    o.depends('disabled', '0');

    o = s.taboption('log', form.Flag, 'timestamp', _('Timestamp'));
    o.default = '1';
    o.rmempty = false;
    o.retain = true;
    o.depends('disabled', '0');

    // dns

    // not local: while sing-box runs, dnsmasq sends its queries back to it,
    // and a query no rule matched would go round
    o = s.taboption('dns', form.ListValue, 'final', _('Default DNS server'));
    o.ucisection = 'dns';
    hako.sectionChoices(o, 'dns_server', null, (section) => !(section.type in { fakeip: 1, local: 1 }));

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
    ss.filter = (section_id) => !(uci.get(hako.profileConfig(), section_id, 'type') in { fakeip: 1, local: 1 });
    // added with a dialog, without a section name to type first
    ss.anonymous = true;
    hako.named(ss, 'dns');
    ss.addremove = true;
    ss.sortable = true;
    ss.nodescriptions = true;
    ss.modaltitle = (section_id) => _('DNS servers') + ' » ' + (uci.get(hako.profileConfig(), section_id, 'tag') || _('New DNS server'));

    let so = ss.option(form.Value, 'tag', _('Tag'));
    so.rmempty = false;

    so = ss.option(form.ListValue, 'type', _('Type'));
    Object.keys(DNS_TYPES).forEach((type) => so.value(type, DNS_TYPES[type]));
    so.default = 'udp';
    so.textvalue = (section_id) => {
      const type = uci.get(hako.profileConfig(), section_id, 'type');
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
    hako.resolverChoices(so, _('Default'));
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
    hako.duration(o, 'm', _('minutes'));
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
      _('Remote rule sets download with them, chosen as the default on the Rules page or for each rule set.'));
    const hs = o.subsection;
    hs.anonymous = true;
    hako.named(hs, 'http_client');
    hs.addremove = true;
    hs.nodescriptions = true;
    hs.modaltitle = (section_id) => _('HTTP clients') + ' » ' + (uci.get(hako.profileConfig(), section_id, 'tag') || _('New HTTP client'));
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
    so.validate = hako.validateHeader;
    so.modalonly = true;

    // the QUIC fields of version 3 hold the HTTP2 fields of version 2: the
    // same options on both tabs, each kept while the other is shown
    so = hs.taboption('quic', form.Value, 'initial_packet_size', _('Initial packet size'));
    hako.suffix(so, _('bytes'));
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

      hako.duration(http2('idle_timeout', _('Idle timeout')), 's', _('seconds'));
      hako.duration(http2('keep_alive_period', _('Keepalive period')), 's', _('seconds'));

      so = http2('stream_receive_window', _('Stream receive window'));
      so.placeholder = '6MB';
      so.validate = hako.validateSize;

      so = http2('connection_receive_window', _('Connection receive window'));
      so.placeholder = '15MB';
      so.validate = hako.validateSize;

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
    uci.sections(hako.profileConfig(), 'outbound')
      .filter((section) => section.type != 'direct' && section.hidden != '1')
      .forEach((section) => so.value(hako.label(section)));
    so.textvalue = function (section_id) {
      return '%h'.format(this.cfgvalue(section_id) || _('Direct (default)'));
    };
    keepValue(so);

    so = hs.taboption('dial', form.ListValue, '_domain_resolver', _('Domain resolver'));
    so.value('', _('Default'));
    uci.sections(hako.profileConfig(), 'dns_server')
      .filter((section) => section.type != 'fakeip')
      .forEach((section) => so.value(hako.label(section)));
    so.modalonly = true;
    so.depends('_detour', '');
    keepValue(so);

    fields.add(hs, 'dial', 'dial_fields', _('Dial fields'),
      _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box dial fields</a>.')
        .format('https://sing-box.sagernet.org/configuration/shared/dial/'), {
        placeholder: JSON.stringify({ detour: 'Proxy' }, null, 2),
        bind: DIAL_OPTIONS
      });

    // the sing-box API, as services of type api, with a dialog in tabs as
    // the one of an http client

    o = s.taboption('api', form.SectionValue, '_services', form.GridSection, 'service', 'sing-box API',
      _('A gRPC server, gRPC-Web as well, to watch and control sing-box, with a dashboard of its own. See the <a href="%s" target="_blank" rel="noreferrer">sing-box documentation</a>.')
        .format('https://sing-box.sagernet.org/configuration/service/api/'));
    const vs = o.subsection;
    vs.anonymous = true;
    vs.addremove = true;
    vs.nodescriptions = true;
    vs.modaltitle = (section_id) => 'API » ' + (uci.get(hako.profileConfig(), section_id, 'tag') || _('New API'));
    vs.tab('general', _('Basic'));
    vs.tab('tls', 'TLS');
    vs.tab('extra', _('More fields'));

    // switched in the table
    so = vs.taboption('general', form.Flag, 'enabled', _('Enable'));
    so.default = '1';
    so.editable = true;
    so.modalonly = false;

    so = vs.taboption('general', form.Value, 'tag', _('Tag'));
    so.rmempty = false;

    so = vs.taboption('general', form.DummyValue, '_address', _('Address'));
    so.modalonly = false;
    so.textvalue = (section_id) => {
      const section = uci.get(hako.profileConfig(), section_id) ?? {};
      const host = section.listen ?? '';
      return '%h'.format(`${host.includes(':') ? `[${host}]` : host}:${section.listen_port ?? ''}`);
    };

    so = vs.taboption('general', form.Value, 'listen', _('Listen address'));
    so.modalonly = true;
    so.datatype = 'ipaddr(1)';
    so.default = '127.0.0.1';
    so.rmempty = false;

    so = vs.taboption('general', form.Value, 'listen_port', _('Port'));
    so.modalonly = true;
    so.datatype = 'port';
    so.rmempty = false;

    so = vs.taboption('general', form.Value, 'secret', _('Secret'));
    so.modalonly = true;
    so.password = true;

    so = vs.taboption('general', form.DynamicList, 'access_control_allow_origin', _('Allowed origins'));
    so.modalonly = true;
    so.placeholder = 'http://127.0.0.1';

    so = vs.taboption('general', form.Flag, 'access_control_allow_private_network', _('Allow private network'));
    so.modalonly = true;

    so = vs.taboption('general', form.Flag, 'dashboard', _('Dashboard'));
    so.modalonly = true;
    so.description = _('Served at /dashboard/, downloaded when its directory is empty.');

    // kept while the dashboard is off
    const dashboard = (type, name, title) => {
      const option = vs.taboption('general', type, name, title);
      option.modalonly = true;
      option.retain = true;
      option.depends('dashboard', '1');
      return option;
    };

    so = dashboard(form.Value, 'dashboard_path', _('Dashboard directory'));
    so.placeholder = '/etc/hako/dashboard';

    so = dashboard(form.Value, 'dashboard_download_url', _('Dashboard download URL'));
    so.validate = (section_id, value) => (!value || /^https?:\/\/\S+$/.test(value)) ? true : _('Expecting an HTTP or HTTPS URL');

    so = dashboard(form.ListValue, 'dashboard_http_client', _('HTTP client'));
    hako.sectionChoices(so, 'http_client', _('Default'));

    so = dashboard(form.Value, 'dashboard_update_interval', _('Update interval'));
    hako.duration(so, 'h', _('hours'));
    so.placeholder = '24';

    fields.add(vs, 'tls', 'tls_fields', _('TLS fields'),
      _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box TLS fields</a>, as of an inbound.')
        .format('https://sing-box.sagernet.org/configuration/shared/tls/#inbound'), {
        placeholder: JSON.stringify({ enabled: true, certificate_path: '/etc/hako/cert.pem', key_path: '/etc/hako/key.pem' }, null, 2)
      });

    fields.add(vs, 'extra', 'extra_fields', _('More fields'),
      _('A JSON object of further fields, such as the listen fields; they go over the ones above.'), {
        placeholder: JSON.stringify({ tcp_fast_open: true }, null, 2)
      });

    // experimental: a tab per object, each a section of the device in
    // hako; options are named by section and option

    o = s.taboption('experimental', form.SectionValue, '_experimental', form.NamedSection, 'log', 'log');
    const es = o.subsection;
    es.tab('clash_api', 'Clash API');
    es.tab('cache_file', _('Cache file'));

    const experimental = (section, type, option, title) => {
      const opt = es.taboption(section, type, `${section}_${option}`, title);
      opt.uciconfig = 'hako';
      opt.ucisection = section;
      opt.ucioption = option;
      return opt;
    };

    // clash api; its default mode is the mode Hako switches, from the
    // Policies page

    so = experimental('clash_api', form.Value, 'external_controller', _('Listen address'));
    so.description = _('Switching the outbound mode, choosing in groups and testing latency use it; empty turns the Clash API off.');
    so.datatype = 'ipaddrport(1)';
    so.placeholder = '127.0.0.1:9090';

    so = experimental('clash_api', form.Value, 'secret', _('Secret'));
    so.description = _('Set one when the address is reachable from other devices.');
    so.password = true;

    so = experimental('clash_api', form.Value, 'external_ui', _('External UI'));
    so.description = _('A directory of a web UI, served at /ui; relative to %s, which is cleared on reboot. Downloaded when empty.').format('/var/run/hako');
    so.placeholder = '/etc/hako/ui';

    so = experimental('clash_api', form.Value, 'external_ui_download_url', _('External UI download URL'));
    so.description = _('A ZIP archive of the web UI.');
    so.placeholder = 'https://github.com/MetaCubeX/Yacd-meta/archive/gh-pages.zip';
    so.validate = (section_id, value) => (!value || /^https?:\/\/\S+$/.test(value)) ? true : _('Expecting an HTTP or HTTPS URL');
    so.depends({ clash_api_external_ui: /./ });

    so = experimental('clash_api', form.ListValue, 'external_ui_download_detour', _('External UI download outbound'));
    so.value('', _('Default outbound'));
    hako.outboundChoices(so);
    so.depends({ clash_api_external_ui: /./ });

    so = experimental('clash_api', form.DynamicList, 'access_control_allow_origin', _('Allowed origins'));
    so.description = _('The origins of web pages allowed to call the API (CORS); all when empty.');
    so.placeholder = 'http://127.0.0.1';

    so = experimental('clash_api', form.Flag, 'access_control_allow_private_network', _('Allow private network'));
    so.description = _('Allows web pages of public sites to call the API on a private address.');

    // cache file

    so = experimental('cache_file', form.Flag, 'enabled', _('Enable'));
    so.description = _('Keeps the choices of groups and the outbound mode across restarts.');
    so.default = '1';
    so.rmempty = false;

    // kept while the cache file is off
    const cached = (type, option, title) => {
      const opt = experimental('cache_file', type, option, title);
      opt.retain = true;
      opt.depends('cache_file_enabled', '1');
      return opt;
    };

    so = cached(form.Value, 'path', _('Path'));
    so.placeholder = '/etc/hako/cache.db';

    so = cached(form.Value, 'cache_id', _('Cache ID'));
    so.description = _('Keeps the data of this config apart from that of others in the same file.');

    so = cached(form.Flag, 'store_fakeip', _('Store FakeIP'));
    so.description = _('Keeps the FakeIP addresses given out, so they still lead to their domains after a restart.');

    so = cached(form.Flag, 'store_dns', _('Store DNS cache'));
    so.description = _('Keeps the DNS cache across restarts.');

    return m.render().then((node) => E([], [ ...hako.header(), node ]));
  }
});
