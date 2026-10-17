#!/usr/bin/ucode
// Generate the sing-box configuration from /etc/config/openbox and print it as JSON.
//
// Naming follows sing-box wherever sing-box has the field: a section type is a
// top-level key, a section name the key below it, options are sing-box fields,
// and nested fields are joined with "_" (tls.server_name -> tls_server_name).
// What OpenBox adds on top follows mihomo: include_all_proxies,
// include_all_groups, filter and exclude_filter.

'use strict';

import { cursor } from 'uci';

const CONFIG = 'openbox';

// OPENBOX_CONFDIR and OPENBOX_SAVEDIR point the tests at their own config
const uci = cursor(getenv('OPENBOX_CONFDIR'), getenv('OPENBOX_SAVEDIR'));
uci.load(CONFIG);

function bool(value) {
	return value in [ '1', 'true', 'yes', 'on' ];
}

function list(value) {
	if (type(value) == 'array')
		return value;

	return (value != null && value != '') ? [ value ] : [];
}

// a list, or null when it is empty
function nonempty(value) {
	const items = list(value);
	return length(items) ? items : null;
}

function number(value) {
	const n = int(value);
	return (value != null && value != '' && n == n) ? n : null;
}

function merge(target, source) {
	for (let key, value in source)
		target[key] = value;

	return target;
}

// drop null values recursively, so options that are not set are left out
function clean(value) {
	if (type(value) == 'object') {
		const result = {};
		for (let key, item in value) {
			item = clean(item);
			if (item != null)
				result[key] = item;
		}
		return result;
	}

	if (type(value) == 'array')
		return map(filter(value, (item) => item != null), clean);

	return value;
}

function compile(pattern, where) {
	if (!pattern)
		return null;

	try {
		return regexp(pattern);
	}
	catch (e) {
		warn(`openbox: ${where}: invalid regular expression '${pattern}'\n`);
		return null;
	}
}

// singleton objects: options are sing-box fields, converted by these types

const LOG_FIELDS = {
	disabled: 'bool', level: 'string', output: 'string', timestamp: 'bool'
};

const CLASH_API_FIELDS = {
	external_controller: 'string', secret: 'string', default_mode: 'string',
	access_control_allow_origin: 'list', access_control_allow_private_network: 'bool'
};

const CACHE_FILE_FIELDS = {
	enabled: 'bool', path: 'string', cache_id: 'string', store_fakeip: 'bool'
};

// "outbound" and "dns_server" fields refer to another section by name or tag
const DNS_FIELDS = {
	final: 'dns_server', strategy: 'string', disable_cache: 'bool', disable_expire: 'bool',
	cache_capacity: 'number', optimistic: 'bool', timeout: 'string',
	reverse_mapping: 'bool', client_subnet: 'string', custom_rules: 'openbox'
};

const NTP_FIELDS = {
	enabled: 'bool', server: 'string', server_port: 'number', interval: 'string',
	detour: 'detour', domain_resolver: 'dns_server'
};

const ROUTE_FIELDS = {
	final: 'outbound', default_domain_resolver: 'dns_server', auto_detect_interface: 'bool',
	find_neighbor: 'bool', dhcp_lease_files: 'list', default_http_client: 'http_client'
};

// array elements: inbounds, http clients, rule sets and rules

const INBOUND_FIELDS = {
	tag: 'string', type: 'string', listen: 'string', listen_port: 'number', network: 'string',
	interface_name: 'string', address: 'list', mtu: 'number',
	auto_route: 'bool', auto_redirect: 'bool', strict_route: 'bool', stack: 'string', dns_mode: 'string',
	route_address: 'list', route_exclude_address: 'list',
	route_address_set: 'rule_sets', route_exclude_address_set: 'rule_sets',
	include_interface: 'list', exclude_interface: 'list',
	include_mac_address: 'list', exclude_mac_address: 'list', exclude_uid: 'numbers',
	username: 'string', password: 'string'
};

const HTTP_CLIENT_FIELDS = {
	tag: 'string', detour: 'detour'
};

const RULE_SET_FIELDS = {
	tag: 'string', type: 'string', format: 'string', url: 'string', path: 'string',
	initial_path: 'string', http_client: 'http_client', update_interval: 'string', rules: 'json_list'
};

// match fields shared by dns and route rules
const MATCH_FIELDS = {
	domain: 'list', domain_suffix: 'list', domain_keyword: 'list', domain_regex: 'list',
	ip_cidr: 'list', ip_is_private: 'bool', source_ip_cidr: 'list', rule_set: 'rule_sets',
	clash_mode: 'string', invert: 'bool'
};

const DNS_RULE_FIELDS = merge({
	action: 'string', server: 'dns_server', tag: 'string', timeout: 'string',
	disable_cache: 'bool', rewrite_ttl: 'number', query_type: 'list', match_response: 'match_response',
	response_rcode: 'string', ip_accept_any: 'bool'
}, MATCH_FIELDS);

const ROUTE_RULE_FIELDS = merge({
	action: 'string', outbound: 'outbound', method: 'string', no_drop: 'bool',
	inbound: 'list', ip_version: 'number', auth_user: 'list', protocol: 'list', network: 'list',
	port: 'numbers', port_range: 'list', source_port: 'numbers', source_port_range: 'list',
	source_ip_is_private: 'bool', source_mac_address: 'list', source_hostname: 'list',
	comment: 'openbox'
}, MATCH_FIELDS);

// convert the options of a section by a field table; "enabled" is the UCI
// switch of array elements unless the object has a field of that name, and
// "hidden" only hides a section in LuCI
function convert(section, fields, where, refs) {
	const result = {};
	for (let key, value in section) {
		if (substr(key, 0, 1) == '.' || value == '' || key == 'hidden' || (key == 'enabled' && !fields.enabled))
			continue;

		switch (fields[key]) {
		case 'bool':
			result[key] = bool(value);
			break;

		case 'number':
			result[key] = number(value);
			break;

		case 'numbers':
			result[key] = filter(map(list(value), number), (n) => n != null);
			break;

		case 'list':
			result[key] = list(value);
			break;

		case 'string':
			result[key] = value;
			break;

		// options of OpenBox that are read elsewhere, not copied
		case 'openbox':
			break;

		// JSON written as it is, such as the rules of an inline rule set;
		// one object is a list of one
		case 'json_list':
			try {
				const parsed = json(value);
				result[key] = (type(parsed) == 'object') ? [ parsed ] : parsed;
			}
			catch (e) {
				warn(`openbox: ${where}: ${key}: ${e}\n`);
			}
			break;

		// true for the latest evaluate action without a tag, or that tag
		case 'match_response':
			result[key] = (value in [ '1', 'true' ]) ? true : value;
			break;

		case 'outbound':
		case 'detour':
		case 'dns_server':
		case 'http_client':
			result[key] = refs[fields[key]](value);
			break;

		case 'rule_sets':
			result[key] = filter(map(list(value), refs.rule_set), (tag) => tag != null);
			if (!length(result[key]))
				result[key] = null;
			break;

		default:
			warn(`openbox: ${where}: unsupported option '${key}'\n`);
		}
	}

	return result;
}

function mirror(sectionType, name, fields, refs) {
	const section = uci.get_all(CONFIG, name);
	if (!section || section['.type'] != sectionType)
		return null;

	return convert(section, fields, `${sectionType}.${name}`, refs);
}

// outbounds: proxies (direct and protocol outbounds) and groups

const GROUP_TYPES = [ 'selector', 'urltest' ];

const sections = [];
uci.foreach(CONFIG, 'outbound', (section) => {
	if (section.enabled != '0')
		push(sections, section);
});

function tag(section) {
	return section.tag || section['.name'];
}

function tls(section, required) {
	if (!required && !bool(section.tls_enabled))
		return null;

	const reality = bool(section.tls_reality_enabled);
	const fingerprint = section.tls_utls_fingerprint || (reality ? 'chrome' : null);

	return {
		enabled: true,
		disable_sni: bool(section.tls_disable_sni) || null,
		server_name: section.tls_server_name,
		insecure: bool(section.tls_insecure) || null,
		alpn: nonempty(section.tls_alpn),
		min_version: section.tls_min_version,
		max_version: section.tls_max_version,
		// PEM lines, one list item each
		certificate: nonempty(section.tls_certificate),
		certificate_public_key_sha256: nonempty(section.tls_certificate_public_key_sha256),
		ech: bool(section.tls_ech_enabled) ? {
			enabled: true,
			config: nonempty(section.tls_ech_config)
		} : null,
		fragment: bool(section.tls_fragment) || null,
		record_fragment: bool(section.tls_record_fragment) || null,
		utls: fingerprint ? { enabled: true, fingerprint: fingerprint } : null,
		reality: reality ? {
			enabled: true,
			public_key: section.tls_reality_public_key,
			short_id: section.tls_reality_short_id
		} : null
	};
}

// transport_host is a list for http; ws and httpupgrade take the first host
function transport(section) {
	const hosts = list(section.transport_host);

	switch (section.transport_type) {
	case 'http':
		return {
			type: 'http',
			host: length(hosts) ? hosts : null,
			path: section.transport_path,
			method: section.transport_method
		};

	case 'ws':
		return {
			type: 'ws',
			path: section.transport_path,
			headers: length(hosts) ? { Host: hosts[0] } : null,
			max_early_data: number(section.transport_max_early_data),
			early_data_header_name: section.transport_early_data_header_name
		};

	case 'httpupgrade':
		return { type: 'httpupgrade', host: hosts[0], path: section.transport_path };

	case 'grpc':
		return { type: 'grpc', service_name: section.transport_service_name };

	case 'quic':
		return { type: 'quic' };
	}

	return null;
}

function multiplex(section) {
	if (!bool(section.multiplex_enabled))
		return null;

	return {
		enabled: true,
		protocol: section.multiplex_protocol,
		max_connections: number(section.multiplex_max_connections),
		min_streams: number(section.multiplex_min_streams),
		max_streams: number(section.multiplex_max_streams),
		padding: bool(section.multiplex_padding) || null
	};
}

// hysteria and hysteria2 hop over port ranges instead of one port
function hopping(section) {
	const ranges = list(section.server_ports);
	if (!length(ranges))
		return {};

	return {
		server_port: null,
		server_ports: ranges,
		hop_interval: section.hop_interval,
		hop_interval_max: (section.type == 'hysteria2') ? section.hop_interval_max : null
	};
}

// wireguard is an endpoint of sing-box, with the server as its one peer.
// Its tag is used like the tag of an outbound
function wireguard_endpoint(section) {
	const reserved = map(filter(split(section.peer_reserved ?? '', ','), (part) => trim(part) != ''), (part) => int(trim(part)));
	const allowed = list(section.peer_allowed_ips);

	return {
		type: 'wireguard',
		tag: tag(section),
		mtu: number(section.mtu),
		address: list(section.address),
		private_key: section.private_key,
		peers: [ {
			address: section.server,
			port: number(section.server_port),
			public_key: section.peer_public_key,
			pre_shared_key: section.peer_pre_shared_key,
			allowed_ips: length(allowed) ? allowed : [ '0.0.0.0/0', '::/0' ],
			persistent_keepalive_interval: number(section.peer_persistent_keepalive_interval),
			reserved: length(reserved) ? reserved : null
		} ]
	};
}

function proxy_outbound(section) {
	const outbound = {
		type: section.type,
		tag: tag(section),
		server: section.server,
		server_port: number(section.server_port)
	};

	switch (section.type) {
	case 'direct':
		return { type: 'direct', tag: tag(section) };

	// udp_over_tcp conflicts with multiplex, which takes precedence
	case 'shadowsocks': {
		const mux = multiplex(section);
		const uot = bool(section.udp_over_tcp);
		if (mux && uot)
			warn(`openbox: outbound ${section['.name']}: ignoring udp_over_tcp: multiplex is enabled\n`);

		return merge(outbound, {
			method: section.method,
			password: section.password,
			plugin: section.plugin,
			plugin_opts: section.plugin ? section.plugin_opts : null,
			udp_over_tcp: (uot && !mux) || null,
			multiplex: mux
		});
	}

	case 'vmess':
		return merge(outbound, {
			uuid: section.uuid,
			security: section.security,
			alter_id: number(section.alter_id),
			packet_encoding: section.packet_encoding,
			network: section.network,
			tls: tls(section),
			transport: transport(section),
			multiplex: multiplex(section)
		});

	case 'vless':
		return merge(outbound, {
			uuid: section.uuid,
			flow: section.flow,
			packet_encoding: section.packet_encoding,
			tls: tls(section),
			transport: transport(section),
			multiplex: multiplex(section)
		});

	case 'trojan':
		return merge(outbound, {
			password: section.password,
			tls: tls(section),
			transport: transport(section),
			multiplex: multiplex(section)
		});

	case 'hysteria2':
		return merge(merge(outbound, {
			password: section.password,
			up_mbps: number(section.up_mbps),
			down_mbps: number(section.down_mbps),
			obfs: section.obfs_password ? {
				type: section.obfs_type || 'salamander',
				password: section.obfs_password,
				min_packet_size: (section.obfs_type == 'gecko') ? number(section.obfs_min_packet_size) : null,
				max_packet_size: (section.obfs_type == 'gecko') ? number(section.obfs_max_packet_size) : null
			} : null,
			bbr_profile: section.bbr_profile,
			disable_chrome_parrot: bool(section.disable_chrome_parrot) || null,
			tls: tls(section, true)
		}), hopping(section));

	case 'hysteria':
		return merge(merge(outbound, {
			auth_str: section.auth_str,
			up_mbps: number(section.up_mbps),
			down_mbps: number(section.down_mbps),
			obfs: section.obfs,
			network: section.network,
			tls: tls(section, true)
		}), hopping(section));

	case 'tuic':
		return merge(outbound, {
			uuid: section.uuid,
			password: section.password,
			congestion_control: section.congestion_control,
			udp_relay_mode: section.udp_relay_mode,
			zero_rtt_handshake: bool(section.zero_rtt_handshake) || null,
			network: section.network,
			tls: tls(section, true)
		});

	case 'anytls':
		return merge(outbound, { password: section.password, tls: tls(section, true) });

	// used as the detour of another node, which it hides in a TLS handshake
	case 'shadowtls':
		return merge(outbound, {
			version: number(section.version) ?? 3,
			password: section.password,
			tls: tls(section, true)
		});

	// naive takes the server name only from the tls fields
	case 'naive':
		return merge(outbound, {
			username: section.username,
			password: section.password,
			quic: bool(section.quic) || null,
			tls: { enabled: true, server_name: section.tls_server_name }
		});

	// version 4 obfuscates as HTTP, version 6 shapes traffic instead
	case 'snell': {
		const version = number(section.version) ?? 4;

		return merge(outbound, {
			version: version,
			psk: section.psk,
			reuse: bool(section.reuse) || null,
			network: section.network,
			obfs_mode: (version == 4) ? section.obfs_mode : null,
			obfs_host: (version == 4) ? section.obfs_host : null,
			mode: (version == 6) ? section.mode : null
		});
	}

	case 'ssh':
		return merge(outbound, {
			user: section.user,
			password: section.password,
			private_key_path: section.private_key_path,
			private_key_passphrase: section.private_key_passphrase,
			host_key: nonempty(section.host_key)
		});

	case 'socks':
		return merge(outbound, {
			version: section.version,
			username: section.username,
			password: section.password,
			network: section.network,
			udp_over_tcp: bool(section.udp_over_tcp) || null
		});

	case 'http':
		return merge(outbound, {
			username: section.username,
			password: section.password,
			path: section.path,
			tls: tls(section)
		});

	case 'wireguard':
		return wireguard_endpoint(section);
	}

	warn(`openbox: skipping outbound ${section['.name']}: unsupported type '${section.type}'\n`);
	return null;
}

const groups = filter(sections, (section) => section.type in GROUP_TYPES);

// wireguard goes into the endpoints, the other nodes into the outbounds
const proxyOutbounds = [];
const proxyEndpoints = [];
const proxies = [];
const proxyObjects = [];
for (let section in sections) {
	if (section.type in GROUP_TYPES)
		continue;

	const outbound = proxy_outbound(section);
	if (outbound) {
		push((section.type == 'wireguard') ? proxyEndpoints : proxyOutbounds, outbound);
		push(proxies, section);
		push(proxyObjects, outbound);
	}
}

// a reference is a section name, or else a tag
function find(candidates, ref) {
	if (ref == null || ref == '')
		return null;

	for (let section in candidates)
		if (section['.name'] == ref)
			return section;

	for (let section in candidates)
		if (tag(section) == ref)
			return section;

	return null;
}

function resolve(ref) {
	const section = find(groups, ref) ?? find(proxies, ref);
	return section ? tag(section) : null;
}

// dial fields: sing-box rejects a detour to a plain direct outbound, and
// leaving detour unset already means direct
function resolve_detour(ref) {
	const section = find(proxies, ref);
	if (section?.type == 'direct') {
		warn(`openbox: ignoring detour '${ref}': it is a direct outbound\n`);
		return null;
	}

	return resolve(ref);
}

// dns servers, which nodes may resolve their server with
const dnsServers = [];
uci.foreach(CONFIG, 'dns_server', (section) => {
	if (section.enabled != '0')
		push(dnsServers, section);
});

function resolve_dns(ref) {
	const section = find(dnsServers, ref);
	return section ? tag(section) : null;
}

// dial fields of nodes; a node may connect through another one, as a node
// does through shadowtls
function dial(section) {
	return {
		detour: resolve_detour(section.detour),
		bind_interface: section.bind_interface,
		connect_timeout: section.connect_timeout,
		tcp_fast_open: bool(section.tcp_fast_open) || null,
		tcp_multi_path: bool(section.tcp_multi_path) || null,
		udp_fragment: bool(section.udp_fragment) || null,
		domain_resolver: resolve_dns(section.domain_resolver)
	};
}

for (let i = 0; i < length(proxies); i++)
	if (proxies[i].type != 'direct')
		merge(proxyObjects[i], dial(proxies[i]));

// referenced groups first, then the groups from include_all_groups, then the
// proxies from include_all_proxies (narrowed by filter and exclude_filter),
// then referenced proxies, so a referenced Direct stays at the end.
// include_all_groups skips groups that set it as well, so they never contain
// each other; include_all_proxies skips direct outbounds, and shadowtls,
// which only carries another node.
function group_members(group) {
	const result = [];
	const refs = list(group.outbounds);
	const where = `outbound ${group['.name']}`;

	for (let ref in refs) {
		const member = find(groups, ref);
		if (member && member != group)
			push(result, tag(member));
	}

	if (bool(group.include_all_groups))
		for (let other in groups)
			if (other != group && !bool(other.include_all_groups))
				push(result, tag(other));

	if (bool(group.include_all_proxies)) {
		const include = compile(group.filter, where);
		const exclude = compile(group.exclude_filter, where);

		for (let proxy in proxies) {
			const name = tag(proxy);
			if (!(proxy.type in [ 'direct', 'shadowtls' ]) &&
			    (!include || match(name, include)) &&
			    !(exclude && match(name, exclude)))
				push(result, name);
		}
	}

	for (let ref in refs) {
		const member = find(proxies, ref);
		if (member)
			push(result, tag(member));
	}

	if (!length(result))
		warn(`openbox: ${where} has no outbounds\n`);

	return uniq(result);
}

function group_outbound(group) {
	const members = group_members(group);
	const outbound = {
		type: group.type,
		tag: tag(group),
		outbounds: members,
		interrupt_exist_connections: bool(group.interrupt_exist_connections) || null
	};

	if (group.type == 'urltest')
		return merge(outbound, {
			url: group.url,
			interval: group.interval,
			tolerance: number(group.tolerance),
			idle_timeout: group.idle_timeout
		});

	// sing-box refuses a default that is not a member
	const fallback = resolve(group.default);
	if (fallback && !(fallback in members)) {
		warn(`openbox: outbound ${group['.name']}: default '${fallback}' is not a member, using the first one\n`);
		return outbound;
	}

	return merge(outbound, { default: fallback });
}

const groupOutbounds = map(groups, group_outbound);

// dns servers

const REMOTE_DNS_TYPES = [ 'udp', 'tcp', 'tls', 'quic', 'https', 'h3' ];
const TLS_DNS_TYPES = [ 'tls', 'quic', 'https', 'h3' ];

function dns_server(section) {
	const server = { type: section.type, tag: tag(section) };

	if (section.type == 'fakeip')
		return merge(server, { inet4_range: section.inet4_range, inet6_range: section.inet6_range });

	// dial fields, shared by local and remote servers
	merge(server, {
		detour: resolve_detour(section.detour),
		domain_resolver: resolve_dns(section.domain_resolver)
	});

	if (section.type == 'local')
		return merge(server, { prefer_go: bool(section.prefer_go) || null });

	if (section.type in REMOTE_DNS_TYPES) {
		const tlsOptions = (section.type in TLS_DNS_TYPES && (section.tls_server_name || bool(section.tls_insecure))) ? {
			enabled: true,
			server_name: section.tls_server_name,
			insecure: bool(section.tls_insecure) || null
		} : null;

		return merge(server, {
			server: section.server,
			server_port: number(section.server_port),
			path: (section.type in [ 'https', 'h3' ]) ? section.path : null,
			tls: tlsOptions
		});
	}

	warn(`openbox: skipping dns_server ${section['.name']}: unsupported type '${section.type}'\n`);
	return null;
}

const dnsServerObjects = filter(map(dnsServers, dns_server), (server) => server != null);

// http clients and rule sets

function enabled_sections(sectionType) {
	const result = [];
	uci.foreach(CONFIG, sectionType, (section) => {
		if (section.enabled != '0')
			push(result, section);
	});

	return result;
}

const httpClients = enabled_sections('http_client');
const ruleSets = enabled_sections('rule_set');

function resolve_http_client(ref) {
	const section = find(httpClients, ref);
	return section ? tag(section) : null;
}

function resolve_rule_set(ref) {
	const section = find(ruleSets, ref);
	if (!section)
		warn(`openbox: unknown rule_set '${ref}'\n`);

	return section ? tag(section) : null;
}

const refs = {
	outbound: resolve, detour: resolve_detour, dns_server: resolve_dns,
	http_client: resolve_http_client, rule_set: resolve_rule_set
};

// array elements converted by their field tables; keep() returns why an
// element is skipped, and named elements get the section name as default tag
function elements(sectionType, fields, keep, named) {
	const result = [];

	for (let section in enabled_sections(sectionType)) {
		const where = `${sectionType} ${section['.name']}`;
		const element = convert(section, fields, where, refs);

		if (named)
			element.tag = tag(section);

		const reason = keep(element);
		if (reason)
			warn(`openbox: skipping ${where}: ${reason}\n`);
		else
			push(result, element);
	}

	return result;
}

// inbounds that take over traffic: tun or tproxy, with a direct one for DNS;
// and mixed, a proxy port for devices set up by hand
const INBOUND_TYPES = [ 'tun', 'tproxy', 'direct', 'mixed' ];

const inbounds = elements('inbound', INBOUND_FIELDS, (inbound) =>
	!(inbound.type in INBOUND_TYPES) ? `unsupported type '${inbound.type}'` : null, true);

// the one user of a mixed inbound is set in UCI as its username and password
for (let inbound in inbounds) {
	if (inbound.type == 'mixed' && inbound.username && inbound.password)
		inbound.users = [ { username: inbound.username, password: inbound.password } ];

	delete inbound.username;
	delete inbound.password;
}

// in Global mode every connection goes through sing-box, so nothing bypasses
// it in the firewall; switching the mode keeps it in main.mode
const mode = uci.get(CONFIG, 'main', 'mode') ?? uci.get(CONFIG, 'clash_api', 'default_mode') ?? '';
if (lc(mode) == 'global')
	for (let inbound in inbounds)
		delete inbound.route_exclude_address_set;

// with tproxy, OpenBox sets up the firewall and skips connections carrying
// this mark, so sing-box marks its own
function default_mark() {
	for (let inbound in inbounds) {
		if (inbound.type == 'tproxy') {
			// "+" also reads hexadecimal such as 0x6f63
			const mark = +(uci.get(CONFIG, 'firewall', 'output_mark') ?? '');
			return (mark > 0) ? mark : null;
		}
	}

	return null;
}

const httpClientObjects = elements('http_client', HTTP_CLIENT_FIELDS, () => null, true);

const ruleSetObjects = elements('rule_set', RULE_SET_FIELDS, (ruleSet) =>
	(ruleSet.type == 'remote' && !ruleSet.url) ? 'needs url' :
	(ruleSet.type == 'local' && !ruleSet.path) ? 'needs path' :
	(ruleSet.type == 'inline' && type(ruleSet.rules) != 'array') ? 'needs rules' : null, true);

// actions that send a query to a server need a valid one
const dnsRules = elements('dns_rule', DNS_RULE_FIELDS, (rule) =>
	((rule.action ?? 'route') in [ 'route', 'evaluate' ] && !rule.server) ? 'needs a valid server' : null);

// dns.custom_rules: sing-box dns rules written as JSON, an array taken as it
// is; they go in front of the split between mainland and foreign answers,
// which starts with the evaluate action, behind the rules for LAN names
const customRules = (() => {
	const text = uci.get(CONFIG, 'dns', 'custom_rules');
	if (!text)
		return [];

	let rules;
	try {
		rules = json(text);
	}
	catch (e) {
		warn(`openbox: skipping dns.custom_rules: ${e}\n`);
		return [];
	}

	if (type(rules) == 'object')
		rules = [ rules ];

	if (type(rules) != 'array' || length(filter(rules, (rule) => type(rule) != 'object'))) {
		warn('openbox: skipping dns.custom_rules: not an array of rules\n');
		return [];
	}

	return rules;
})();

if (length(customRules)) {
	let at = length(dnsRules);
	for (let i = 0; i < length(dnsRules); i++) {
		if (dnsRules[i].action == 'evaluate') {
			at = i;
			break;
		}
	}

	for (let i = length(customRules) - 1; i >= 0; i--)
		splice(dnsRules, at, 0, customRules[i]);
}

// the route action, the default, needs a valid outbound
const routeRules = elements('route_rule', ROUTE_RULE_FIELDS, (rule) =>
	((rule.action ?? 'route') == 'route' && !rule.outbound) ? 'needs a valid outbound' : null);

const config = {
	'$schema': 'https://sing-box.sagernet.org/schema.json',
	log: mirror('log', 'log', LOG_FIELDS, refs),
	dns: merge(mirror('dns', 'dns', DNS_FIELDS, refs) ?? {}, { servers: dnsServerObjects, rules: dnsRules }),
	ntp: mirror('ntp', 'ntp', NTP_FIELDS, refs),
	inbounds: inbounds,
	outbounds: [
		...proxyOutbounds,
		...groupOutbounds
	],
	endpoints: length(proxyEndpoints) ? proxyEndpoints : null,
	http_clients: httpClientObjects,
	route: merge(mirror('route', 'route', ROUTE_FIELDS, refs) ?? {}, {
		default_mark: default_mark(),
		rules: routeRules,
		rule_set: ruleSetObjects
	}),
	experimental: {
		clash_api: mirror('experimental', 'clash_api', CLASH_API_FIELDS, refs),
		cache_file: mirror('experimental', 'cache_file', CACHE_FILE_FIELDS, refs)
	}
};

printf('%.J\n', clean(config));
