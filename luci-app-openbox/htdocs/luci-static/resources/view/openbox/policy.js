'use strict';
'require view';
'require openbox.ui as openbox';
'require form';
'require uci';
'require rpc';
'require poll';
'require ui';
'require dom';

const callMode = rpc.declare({
	object: 'luci.openbox',
	method: 'mode',
	expect: { '': {} }
});

const callOutbounds = rpc.declare({
	object: 'luci.openbox',
	method: 'outbounds',
	expect: { '': {} }
});

const callSelect = rpc.declare({
	object: 'luci.openbox',
	method: 'select',
	params: [ 'group', 'outbound' ],
	expect: { '': {} }
});

const unavailableReasons = {
	no_clash_api: _('The clash API is not enabled in the current profile, so the outbound mode cannot be changed.')
};

const GROUP_TYPES = {
	selector: _('Manual selection'),
	urltest: _('Auto by latency')
};

// the node types the generator supports; wireguard becomes an endpoint of
// sing-box, used like an outbound
const NODE_TYPES = {
	shadowsocks: 'Shadowsocks',
	vmess: 'VMess',
	vless: 'VLESS',
	trojan: 'Trojan',
	hysteria2: 'Hysteria2',
	hysteria: 'Hysteria',
	tuic: 'TUIC',
	anytls: 'AnyTLS',
	shadowtls: 'ShadowTLS',
	naive: 'NaiveProxy',
	snell: 'Snell',
	wireguard: 'WireGuard',
	ssh: 'SSH',
	socks: 'SOCKS',
	http: 'HTTP'
};

// TLS is optional for some types and always on for others; naive takes the
// server name only, and uTLS works over TCP only
const TLS_OPTIONAL = [ 'vmess', 'vless', 'trojan', 'http' ];
const TLS_REQUIRED = [ 'hysteria2', 'hysteria', 'tuic', 'anytls', 'shadowtls', 'naive' ];
const UTLS_TYPES = [ 'vmess', 'vless', 'trojan', 'http', 'anytls', 'shadowtls' ];

const SS_METHODS = [
	'2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
	'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
	'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305', 'none'
];

const UTLS_FINGERPRINTS = [ 'chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized' ];

// a tag is shared by groups and nodes and must be unique among all outbounds
function validateTag(section_id, value) {
	if (value == 'GLOBAL')
		return _('GLOBAL is reserved by the clash API.');

	if (uci.sections('openbox', 'outbound').some((section) => section['.name'] != section_id && openbox.label(section) == value))
		return _('Another outbound already uses this name.');

	return true;
}

return view.extend({
	load() {
		return Promise.all([ callMode(), callOutbounds(), uci.load('openbox') ]);
	},

	handleSelect(group, ev) {
		return callSelect(group, ev.target.value).then((res) => {
			if (!res.result)
				ui.addNotification(null, E('p', _('Unable to switch the outbound of %s.').format(group)), 'danger');

			return this.refresh();
		});
	},

	// the latest delay sing-box measured; a group without one of its own
	// has the one of its current outbound
	delayOf(name) {
		for (let depth = 0; depth < 8; depth++) {
			const delay = this.runtime.delays?.[name];
			if (delay > 0)
				return delay;

			const group = this.runtime.groups?.[name];
			if (!group)
				break;

			name = group.now;
		}

		return null;
	},

	// the outbound mode, set on sing-box when the settings are applied
	renderMode(m, state) {
		const s = m.section(form.NamedSection, 'main', 'openbox', _('Outbound mode'),
			_('The current outbound of each group takes effect immediately; other changes, the outbound mode included, after Save & Apply.'));

		if (!state.available) {
			const o = s.option(form.DummyValue, '_mode', _('Mode'));
			o.cfgvalue = () => unavailableReasons[state.reason] ?? state.reason;
			return;
		}

		// sing-box matches modes regardless of case
		const modes = [ ...state.modes ];
		const find = (value) => modes.find((mode) => mode.toLowerCase() == value?.toLowerCase());
		if (state.mode && !find(state.mode))
			modes.push(state.mode);

		const o = s.option(form.ListValue, 'mode', _('Mode'));
		o.widget = 'radio';
		o.orientation = 'horizontal';
		modes.forEach((mode) => o.value(mode, openbox.modeNames[mode.toLowerCase()] ?? mode));
		o.default = state.default;
		o.cfgvalue = (section_id) => find(uci.get('openbox', section_id, 'mode')) ?? state.default;

		if (modes.length < 2)
			o.description = _('The current profile defines no other mode. Add route rules with clash_mode to switch modes.');
	},

	// the current outbound of a group: a select for selector groups
	renderNow(tag, group) {
		if (!group)
			return E('em', {}, '-');

		if (group.type != 'selector')
			return E('span', {}, '%h'.format(group.now));

		return E('select', {
			'class': 'cbi-input-select',
			'change': ui.createHandlerFn(this, 'handleSelect', tag)
		}, group.all.map((name) => E('option', {
			'value': name,
			'selected': name == group.now ? '' : null
		}, this.delayOf(name) ? '%h (%d ms)'.format(name, this.delayOf(name)) : '%h'.format(name))));
	},

	updateCell(section_id) {
		const cell = this.cells[section_id];
		const tag = openbox.label(uci.get('openbox', section_id) ?? {});
		const group = this.runtime.groups?.[tag];
		const key = JSON.stringify([ tag, group, group?.all.map((name) => this.delayOf(name)) ]);

		// leave an open select alone until the user is done with it
		if (key != cell.key && document.activeElement?.parentNode != cell.node) {
			cell.key = key;
			dom.content(cell.node, this.renderNow(tag, group));
		}
	},

	updateCells() {
		for (const section_id in this.cells)
			if (this.cells[section_id].node.isConnected)
				this.updateCell(section_id);
	},

	refresh() {
		return callOutbounds().then((data) => {
			this.runtime = data;
			this.updateCells();
		});
	},

	// the current outbound of each group, from the running sing-box
	nowColumn(s) {
		const o = s.option(form.DummyValue, '_now', _('Current outbound'));
		o.modalonly = false;
		o.textvalue = (section_id) => {
			this.cells[section_id] = { node: E('div') };
			this.updateCell(section_id);

			return this.cells[section_id].node;
		};
	},

	renderGroups(m) {
		const s = m.section(form.GridSection, 'outbound', _('Policy groups'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.filter = (section_id) => uci.get('openbox', section_id, 'type') in GROUP_TYPES && !openbox.isHidden(section_id);
		s.modaltitle = (section_id) => _('Policy groups') + ' » ' + (uci.get('openbox', section_id, 'tag') || _('New group'));

		let o = s.option(form.Value, 'tag', _('Name'));
		o.rmempty = false;
		o.validate = validateTag;

		o = s.option(form.ListValue, 'type', _('Type'));
		Object.keys(GROUP_TYPES).forEach((type) => o.value(type, GROUP_TYPES[type]));
		o.default = 'selector';
		o.textvalue = (section_id) => GROUP_TYPES[uci.get('openbox', section_id, 'type')];

		this.nowColumn(s);

		o = s.option(form.MultiValue, 'outbounds', _('Members'));
		o.modalonly = true;
		// any outbound except the group itself
		o.load = function(section_id) {
			this.keylist = [];
			this.vallist = [];
			openbox.outboundChoices(this, section_id);

			return form.MultiValue.prototype.load.call(this, section_id);
		};

		o = s.option(form.Flag, 'include_all_proxies', _('Include all nodes'));
		o.modalonly = true;

		o = s.option(form.Value, 'filter', _('Node filter'));
		o.description = _('A regular expression matched against node names.');
		o.placeholder = '香港|HK';
		o.modalonly = true;
		o.depends('include_all_proxies', '1');

		o = s.option(form.Value, 'exclude_filter', _('Node exclusion'));
		o.placeholder = '过期|剩余';
		o.modalonly = true;
		o.depends('include_all_proxies', '1');

		o = s.option(form.Flag, 'include_all_groups', _('Include all groups'));
		o.modalonly = true;

		o = s.option(form.ListValue, 'default', _('Default outbound'));
		o.description = _('Selected until another one is picked. Must be a member; the first member is used if empty.');
		o.modalonly = true;
		o.depends('type', 'selector');
		o.load = function(section_id) {
			this.keylist = [];
			this.vallist = [];
			this.value('', _('First member'));
			openbox.outboundChoices(this, section_id);

			return form.ListValue.prototype.load.call(this, section_id);
		};

		o = s.option(form.Value, 'url', _('Test URL'));
		o.placeholder = 'https://www.gstatic.com/generate_204';
		o.modalonly = true;
		o.depends('type', 'urltest');

		o = s.option(form.Value, 'interval', _('Test interval'));
		openbox.duration(o, 'm', _('minutes'));
		o.placeholder = '3';
		o.modalonly = true;
		o.depends('type', 'urltest');

		o = s.option(form.Value, 'idle_timeout', _('Idle timeout'));
		o.description = _('Tests pause after the group has not been used for this long.');
		openbox.duration(o, 'm', _('minutes'));
		o.placeholder = '30';
		o.modalonly = true;
		o.depends('type', 'urltest');

		o = s.option(form.Value, 'tolerance', _('Tolerance'));
		openbox.suffix(o, _('ms'));
		o.datatype = 'uinteger';
		o.placeholder = '50';
		o.modalonly = true;
		o.depends('type', 'urltest');

		o = s.option(form.Flag, 'interrupt_exist_connections', _('Interrupt existing connections'));
		o.description = _('Closes the connections of the previous outbound when the outbound in use changes.');
		o.modalonly = true;
	},

	renderNodes(m) {
		const s = m.section(form.GridSection, 'outbound', _('Nodes'));
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;
		s.nodescriptions = true;
		s.filter = (section_id) => !(uci.get('openbox', section_id, 'type') in GROUP_TYPES) && !openbox.isHidden(section_id);
		s.modaltitle = (section_id) => _('Nodes') + ' » ' + (uci.get('openbox', section_id, 'tag') || _('New node'));

		let o = s.option(form.Value, 'tag', _('Name'));
		o.rmempty = false;
		o.validate = validateTag;

		o = s.option(form.ListValue, 'type', _('Protocol'));
		Object.keys(NODE_TYPES).forEach((type) => o.value(type, NODE_TYPES[type]));
		o.default = 'shadowsocks';
		o.textvalue = (section_id) => {
			const type = uci.get('openbox', section_id, 'type');
			return NODE_TYPES[type] ?? '%h'.format(type ?? '-');
		};

		const remote = (option, types) => (types ?? Object.keys(NODE_TYPES)).forEach((type) => option.depends('type', type));

		o = s.option(form.Value, 'server', _('Server'));
		o.datatype = 'host';
		o.rmempty = false;
		remote(o);
		o.textvalue = (section_id) => {
			const server = uci.get('openbox', section_id, 'server');
			const port = uci.get('openbox', section_id, 'server_port');

			return server ? '%h'.format(port ? `${server}:${port}` : server) : '-';
		};

		o = s.option(form.Value, 'server_port', _('Port'));
		o.datatype = 'port';
		o.rmempty = false;
		o.modalonly = true;
		remote(o);

		// port hopping, in place of the port
		o = s.option(form.DynamicList, 'server_ports', _('Port ranges'));
		o.description = _('Hops between ports of these ranges, such as 20000:30000, in place of the port.');
		o.placeholder = '20000:30000';
		o.validate = (section_id, value) => (!value || /^\d+:\d+$/.test(value)) ? true : _('Expecting a range such as 1000:2000');
		o.modalonly = true;
		remote(o, [ 'hysteria2', 'hysteria' ]);

		o = s.option(form.Value, 'hop_interval', _('Hop interval'));
		openbox.duration(o, 's', _('seconds'));
		o.placeholder = '30';
		o.modalonly = true;
		remote(o, [ 'hysteria2', 'hysteria' ]);

		// credentials

		o = s.option(form.ListValue, 'method', _('Encryption method'));
		SS_METHODS.forEach((method) => o.value(method));
		o.default = '2022-blake3-aes-128-gcm';
		o.modalonly = true;
		o.depends('type', 'shadowsocks');

		o = s.option(form.Value, 'username', _('Username'));
		o.modalonly = true;
		remote(o, [ 'naive', 'socks', 'http' ]);

		o = s.option(form.Value, 'user', _('Username'));
		o.placeholder = 'root';
		o.modalonly = true;
		o.depends('type', 'ssh');

		o = s.option(form.Value, 'password', _('Password'));
		o.password = true;
		o.modalonly = true;
		remote(o, [ 'shadowsocks', 'trojan', 'hysteria2', 'tuic', 'anytls', 'shadowtls', 'naive', 'ssh', 'socks', 'http' ]);

		o = s.option(form.Value, 'auth_str', _('Password'));
		o.password = true;
		o.modalonly = true;
		o.depends('type', 'hysteria');

		o = s.option(form.Value, 'uuid', 'UUID');
		o.rmempty = false;
		o.modalonly = true;
		remote(o, [ 'vmess', 'vless', 'tuic' ]);

		o = s.option(form.ListValue, 'flow', _('XTLS flow'));
		o.value('', _('None'));
		o.value('xtls-rprx-vision');
		o.modalonly = true;
		o.depends('type', 'vless');

		// vmess

		o = s.option(form.ListValue, 'security', _('Encryption method'));
		[ 'auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr' ].forEach((method) => o.value(method));
		o.default = 'auto';
		o.modalonly = true;
		o.depends('type', 'vmess');

		o = s.option(form.Value, 'alter_id', 'Alter ID');
		o.description = _('0 uses the AEAD protocol; servers of the legacy protocol need 1.');
		o.datatype = 'uinteger';
		o.placeholder = '0';
		o.modalonly = true;
		o.depends('type', 'vmess');

		// vmess and vless
		o = s.option(form.ListValue, 'packet_encoding', _('UDP packet encoding'));
		o.value('', _('Default'));
		o.value('packetaddr', 'packetaddr');
		o.value('xudp', 'xudp');
		o.modalonly = true;
		remote(o, [ 'vmess', 'vless' ]);

		// tuic

		o = s.option(form.ListValue, 'congestion_control', _('Congestion control'));
		o.value('', 'cubic');
		o.value('new_reno');
		o.value('bbr');
		o.modalonly = true;
		o.depends('type', 'tuic');

		o = s.option(form.ListValue, 'udp_relay_mode', _('UDP relay mode'));
		o.value('', 'native');
		o.value('quic');
		o.modalonly = true;
		o.depends('type', 'tuic');

		o = s.option(form.Flag, 'zero_rtt_handshake', _('0-RTT handshake'));
		o.modalonly = true;
		o.depends('type', 'tuic');

		// shadowtls: the version option is shared with snell and socks, so
		// each keeps its value

		o = s.option(form.ListValue, '_shadowtls_version', _('ShadowTLS version'));
		o.ucioption = 'version';
		o.value('3', 'v3');
		o.value('2', 'v2');
		o.value('1', 'v1');
		o.default = '3';
		o.retain = true;
		o.modalonly = true;
		o.description = _('Set this node as the detour of a Shadowsocks or other node, which then connects through it.');
		o.depends('type', 'shadowtls');

		// naive

		o = s.option(form.Flag, 'quic', 'QUIC');
		o.description = _('Uses QUIC instead of HTTP/2.');
		o.modalonly = true;
		o.depends('type', 'naive');

		// snell: version 4 obfuscates as HTTP, version 6 shapes traffic

		o = s.option(form.ListValue, '_snell_version', _('Snell version'));
		o.ucioption = 'version';
		o.value('4', 'v4 / v5');
		o.value('6', 'v6');
		o.default = '4';
		o.retain = true;
		o.modalonly = true;
		o.depends('type', 'snell');

		o = s.option(form.Value, 'psk', _('Pre-shared key'));
		o.password = true;
		o.rmempty = false;
		o.modalonly = true;
		o.depends('type', 'snell');

		o = s.option(form.Flag, 'reuse', _('Connection reuse'));
		o.modalonly = true;
		o.depends('type', 'snell');

		o = s.option(form.ListValue, 'obfs_mode', _('HTTP obfuscation'));
		o.value('', _('None'));
		o.value('http', 'HTTP');
		o.modalonly = true;
		o.depends({ type: 'snell', _snell_version: '4' });

		o = s.option(form.Value, 'obfs_host', _('Obfuscation host'));
		o.datatype = 'hostname';
		o.placeholder = 'bing.com';
		o.modalonly = true;
		o.depends({ type: 'snell', _snell_version: '4', obfs_mode: 'http' });

		o = s.option(form.ListValue, 'mode', _('Traffic shaping'));
		o.value('', 'default');
		o.value('unshaped');
		o.value('unsafe-raw');
		o.modalonly = true;
		o.depends({ type: 'snell', _snell_version: '6' });

		// wireguard: the server is its one peer

		o = s.option(form.Value, 'private_key', _('Private key'));
		o.password = true;
		o.rmempty = false;
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.DynamicList, 'address', _('Local addresses'));
		o.datatype = 'cidr';
		o.placeholder = '10.0.0.2/32';
		o.rmempty = false;
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.Value, 'peer_public_key', _('Peer public key'));
		o.rmempty = false;
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.Value, 'peer_pre_shared_key', _('Pre-shared key'));
		o.password = true;
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.DynamicList, 'peer_allowed_ips', _('Allowed IPs'));
		o.datatype = 'cidr';
		o.placeholder = '0.0.0.0/0';
		o.description = _('All IPv4 and IPv6 addresses if empty.');
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.Value, 'peer_reserved', _('Reserved bytes'));
		o.placeholder = '0,0,0';
		o.description = _('Three numbers, for servers such as Cloudflare WARP.');
		o.validate = (section_id, value) => (!value || /^\d{1,3},\d{1,3},\d{1,3}$/.test(value.replace(/\s/g, ''))) ? true : _('Expecting three numbers such as 0,0,0');
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.Value, 'peer_persistent_keepalive_interval', _('Keepalive interval'));
		openbox.suffix(o, _('seconds'));
		o.datatype = 'uinteger';
		o.modalonly = true;
		o.depends('type', 'wireguard');

		o = s.option(form.Value, 'mtu', 'MTU');
		o.datatype = 'range(1280,65535)';
		o.placeholder = '1408';
		o.modalonly = true;
		o.depends('type', 'wireguard');

		// ssh

		o = s.option(form.Value, 'private_key_path', _('Private key file'));
		o.placeholder = '/etc/openbox/id_ed25519';
		o.description = _('A key file on the router, in place of or together with the password.');
		o.modalonly = true;
		o.depends('type', 'ssh');

		o = s.option(form.Value, 'private_key_passphrase', _('Private key passphrase'));
		o.password = true;
		o.modalonly = true;
		o.depends('type', 'ssh');

		o = s.option(form.DynamicList, 'host_key', _('Host keys'));
		o.placeholder = 'ssh-ed25519 AAAA…';
		o.description = _('Any host key is accepted if empty.');
		o.modalonly = true;
		o.depends('type', 'ssh');

		// socks

		o = s.option(form.ListValue, '_socks_version', _('SOCKS version'));
		o.ucioption = 'version';
		o.value('', 'SOCKS5');
		o.value('4', 'SOCKS4');
		o.value('4a', 'SOCKS4a');
		o.retain = true;
		o.modalonly = true;
		o.depends('type', 'socks');

		// shadowsocks plugins
		o = s.option(form.ListValue, 'plugin', _('Plugin'));
		o.value('', _('None'));
		o.value('obfs-local');
		o.value('v2ray-plugin');
		o.modalonly = true;
		o.depends('type', 'shadowsocks');

		o = s.option(form.Value, 'plugin_opts', _('Plugin options'));
		o.placeholder = 'obfs=http;obfs-host=www.bing.com';
		o.modalonly = true;
		[ 'obfs-local', 'v2ray-plugin' ].forEach((plugin) => o.depends({ type: 'shadowsocks', plugin: plugin }));

		// socks and shadowsocks
		o = s.option(form.Flag, 'udp_over_tcp', 'UDP over TCP');
		o.description = _('Shadowsocks ignores it while multiplexing is on.');
		o.modalonly = true;
		remote(o, [ 'socks', 'shadowsocks' ]);

		o = s.option(form.ListValue, 'network', _('Network protocols'));
		o.value('', _('TCP and UDP'));
		o.value('tcp', _('TCP only'));
		o.value('udp', _('UDP only'));
		o.modalonly = true;
		remote(o, [ 'vmess', 'hysteria', 'tuic', 'snell', 'socks' ]);

		// http

		o = s.option(form.Value, 'path', _('Path'));
		o.placeholder = '/';
		o.modalonly = true;
		o.depends('type', 'http');

		// hysteria and hysteria2

		o = s.option(form.Value, 'up_mbps', _('Upload bandwidth'));
		openbox.suffix(o, 'Mbps');
		o.datatype = 'uinteger';
		o.modalonly = true;
		o.depends('type', 'hysteria2');
		o.depends('type', 'hysteria');

		o = s.option(form.Value, 'down_mbps', _('Download bandwidth'));
		openbox.suffix(o, 'Mbps');
		o.datatype = 'uinteger';
		o.modalonly = true;
		o.depends('type', 'hysteria2');
		o.depends('type', 'hysteria');

		o = s.option(form.ListValue, 'obfs_type', _('Obfuscation'));
		o.value('', 'Salamander');
		o.value('gecko', 'Gecko');
		o.modalonly = true;
		o.depends('type', 'hysteria2');

		o = s.option(form.Value, 'obfs_password', _('Obfuscation password'));
		o.description = _('Leave empty to disable obfuscation.');
		o.password = true;
		o.modalonly = true;
		o.depends('type', 'hysteria2');

		o = s.option(form.Value, 'obfs', _('Obfuscation password'));
		o.description = _('Leave empty to disable obfuscation.');
		o.password = true;
		o.modalonly = true;
		o.depends('type', 'hysteria');

		// tls

		o = s.option(form.Flag, 'tls_enabled', _('Enable TLS'));
		o.modalonly = true;
		remote(o, TLS_OPTIONAL);

		const tls = (option, types) => {
			types.forEach((type) => (TLS_OPTIONAL.includes(type))
				? option.depends({ type: type, tls_enabled: '1' })
				: option.depends('type', type));
		};

		o = s.option(form.Value, 'tls_server_name', _('TLS server name'));
		o.datatype = 'hostname';
		o.modalonly = true;
		tls(o, [ ...TLS_OPTIONAL, ...TLS_REQUIRED ]);

		const fullTls = [ ...TLS_OPTIONAL, ...TLS_REQUIRED.filter((type) => type != 'naive') ];

		o = s.option(form.Flag, 'tls_insecure', _('Skip certificate verification'));
		o.modalonly = true;
		tls(o, fullTls);

		o = s.option(form.DynamicList, 'tls_alpn', 'ALPN');
		o.placeholder = 'h2';
		o.modalonly = true;
		tls(o, fullTls);

		o = s.option(form.ListValue, 'tls_utls_fingerprint', _('uTLS fingerprint'));
		o.value('', _('None'));
		UTLS_FINGERPRINTS.forEach((fingerprint) => o.value(fingerprint));
		o.modalonly = true;
		tls(o, UTLS_TYPES);

		o = s.option(form.Flag, 'tls_reality_enabled', _('Enable Reality'));
		o.modalonly = true;
		tls(o, [ 'vless' ]);

		o = s.option(form.Value, 'tls_reality_public_key', _('Reality public key'));
		o.rmempty = false;
		o.modalonly = true;
		o.depends({ type: 'vless', tls_enabled: '1', tls_reality_enabled: '1' });

		o = s.option(form.Value, 'tls_reality_short_id', _('Reality short ID'));
		o.modalonly = true;
		o.depends({ type: 'vless', tls_enabled: '1', tls_reality_enabled: '1' });

		// transport, for vmess, vless and trojan

		o = s.option(form.ListValue, 'transport_type', _('Transport protocol'));
		o.value('', 'TCP');
		o.value('ws', 'WebSocket');
		o.value('httpupgrade', 'HTTPUpgrade');
		o.value('grpc', 'gRPC');
		o.value('http', 'HTTP');
		o.value('quic', 'QUIC');
		o.modalonly = true;
		remote(o, [ 'vmess', 'vless', 'trojan' ]);

		o = s.option(form.Value, 'transport_path', _('Path'));
		o.placeholder = '/';
		o.modalonly = true;
		[ 'ws', 'httpupgrade', 'http' ].forEach((type) => o.depends('transport_type', type));

		// a list for http, of which WebSocket and HTTPUpgrade take the first
		o = s.option(form.DynamicList, 'transport_host', _('Host'));
		o.description = _('WebSocket and HTTPUpgrade use the first one.');
		o.datatype = 'hostname';
		o.modalonly = true;
		[ 'ws', 'httpupgrade', 'http' ].forEach((type) => o.depends('transport_type', type));

		o = s.option(form.Value, 'transport_method', _('HTTP method'));
		o.modalonly = true;
		o.depends('transport_type', 'http');

		o = s.option(form.Value, 'transport_max_early_data', _('Early data'));
		openbox.suffix(o, _('bytes'));
		o.description = _('Sends up to this much data with the handshake, such as 2048.');
		o.datatype = 'uinteger';
		o.modalonly = true;
		o.depends('transport_type', 'ws');

		o = s.option(form.Value, 'transport_early_data_header_name', _('Early data header'));
		o.description = _('Xray servers use Sec-WebSocket-Protocol; the data goes in the path if empty.');
		o.placeholder = 'Sec-WebSocket-Protocol';
		o.modalonly = true;
		o.depends('transport_type', 'ws');

		o = s.option(form.Value, 'transport_service_name', _('gRPC service name'));
		o.modalonly = true;
		o.depends('transport_type', 'grpc');

		// multiplex, for vmess, vless, trojan and shadowsocks; the server
		// has to support it

		o = s.option(form.Flag, 'multiplex_enabled', _('Multiplexing'));
		o.description = _('Needs multiplexing on the server as well.');
		o.modalonly = true;
		remote(o, [ 'vmess', 'vless', 'trojan', 'shadowsocks' ]);

		o = s.option(form.ListValue, 'multiplex_protocol', _('Multiplex protocol'));
		o.value('', 'h2mux');
		o.value('smux');
		o.value('yamux');
		o.modalonly = true;
		o.depends('multiplex_enabled', '1');

		// dial: through another node or group, as through a shadowtls node

		o = s.option(form.ListValue, 'detour', _('Detour'));
		o.description = _('Connects to the server through this node or group.');
		o.modalonly = true;
		o.load = function(section_id) {
			this.keylist = [];
			this.vallist = [];
			this.value('', _('None'));
			uci.sections('openbox', 'outbound')
				.filter((section) => section['.name'] != section_id && section.type != 'direct' && !openbox.isHidden(section['.name']))
				.forEach((section) => this.value(section['.name'], openbox.label(section)));

			return form.ListValue.prototype.load.call(this, section_id);
		};
	},

	render(data) {
		this.runtime = data[1];
		// runtime cells of the tables by section name, refilled on every poll
		this.cells = {};

		const m = new form.Map('openbox');

		this.renderMode(m, data[0]);
		this.renderGroups(m);
		this.renderNodes(m);

		return m.render().then((mapEl) => {
			poll.add(() => this.refresh(), 5);

			return E([], [ ...openbox.header(), openbox.profileNotice(), mapEl ]);
		});
	}
});
