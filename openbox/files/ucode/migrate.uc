#!/usr/bin/ucode
// Bring /etc/config/openbox to the current version. Upgrades keep the config,
// so options and sections added to the defaults later have to be added here;
// each step moves the config one version up. The defaults carry the latest
// main.config_version, so a new install runs no step.

'use strict';

import { cursor } from 'uci';

const CONFIG = 'openbox';

const uci = cursor();
uci.load(CONFIG);

// MIGRATIONS[i] moves version i + 1 to i + 2; version 1 is the first release
const MIGRATIONS = [
	// 2: the mixed inbound, a proxy port for devices set up by hand, off
	(uci) => {
		if (uci.get(CONFIG, 'mixed'))
			return;

		uci.set(CONFIG, 'mixed', 'inbound');
		uci.set(CONFIG, 'mixed', 'enabled', '0');
		uci.set(CONFIG, 'mixed', 'type', 'mixed');
		uci.set(CONFIG, 'mixed', 'tag', 'mixed-in');
		uci.set(CONFIG, 'mixed', 'listen', '::');
		uci.set(CONFIG, 'mixed', 'listen_port', '7890');
	},

	// 3: the built-in route rules are hidden on the route rules page, which
	// keeps the rules added there behind them
	(uci) => {
		uci.foreach(CONFIG, 'route_rule', (rule) => {
			if (rule.action in [ 'sniff', 'hijack-dns' ] || rule.clash_mode ||
			    (rule.ip_is_private == '1' && rule.outbound == 'direct'))
				uci.set(CONFIG, rule['.name'], 'hidden', '1');
		});
	},

	// 4: the dns server "local" is of the local type, the system resolver;
	// AliDNS, which it was, is "alidns" now and keeps its uses. A "local"
	// changed by hand stays as it is
	(uci) => {
		if (uci.get(CONFIG, 'local', 'type') != 'udp' || uci.get(CONFIG, 'local', 'server') != '223.5.5.5' ||
		    uci.get(CONFIG, 'alidns'))
			return;

		uci.set(CONFIG, 'alidns', 'dns_server');
		uci.set(CONFIG, 'alidns', 'tag', 'alidns');
		uci.set(CONFIG, 'alidns', 'type', 'udp');
		uci.set(CONFIG, 'alidns', 'server', '223.5.5.5');

		uci.set(CONFIG, 'local', 'type', 'local');
		uci.delete(CONFIG, 'local', 'server');
		uci.delete(CONFIG, 'local', 'server_port');

		const uses = [ [ 'dns', 'final' ], [ 'route', 'default_domain_resolver' ], [ 'ntp', 'domain_resolver' ] ];
		uci.foreach(CONFIG, 'dns_rule', (rule) => push(uses, [ rule['.name'], 'server' ]));
		uci.foreach(CONFIG, 'dns_server', (server) => push(uses, [ server['.name'], 'domain_resolver' ]));

		for (let use in uses)
			if (uci.get(CONFIG, use[0], use[1]) == 'local')
				uci.set(CONFIG, use[0], use[1], 'alidns');
	},

	// 5: FakeIP has an IPv6 range as well, as in the examples of sing-box
	(uci) => {
		if (uci.get(CONFIG, 'fakeip', 'type') == 'fakeip' && !uci.get(CONFIG, 'fakeip', 'inet6_range'))
			uci.set(CONFIG, 'fakeip', 'inet6_range', 'fc00::/18');
	},

	// 6: the bypassed IPv6 addresses take fd00::/8, the unique local
	// addresses in use, for fc00::/7, which also holds the FakeIP range
	(uci) => {
		for (let use in [ [ 'tun', 'route_exclude_address' ], [ 'firewall', 'bypass_address6' ] ]) {
			const list = uci.get(CONFIG, use[0], use[1]);
			if (type(list) == 'array' && 'fc00::/7' in list)
				uci.set(CONFIG, use[0], use[1], map(list, (address) => (address == 'fc00::/7') ? 'fd00::/8' : address));
		}
	},

	// 7: names of the LAN go to the local server, the system resolver, which
	// is dnsmasq on OpenWrt; the dnsmasq server at 127.0.0.1 goes. One changed
	// by hand stays, and so does it while "local" is not the system resolver
	(uci) => {
		if (uci.get(CONFIG, 'dnsmasq', 'type') != 'udp' || uci.get(CONFIG, 'dnsmasq', 'server') != '127.0.0.1' ||
		    uci.get(CONFIG, 'dnsmasq', 'server_port') || uci.get(CONFIG, 'local', 'type') != 'local')
			return;

		const uses = [ [ 'dns', 'final' ], [ 'route', 'default_domain_resolver' ], [ 'ntp', 'domain_resolver' ] ];
		uci.foreach(CONFIG, 'dns_rule', (rule) => push(uses, [ rule['.name'], 'server' ]));
		uci.foreach(CONFIG, 'dns_server', (server) => push(uses, [ server['.name'], 'domain_resolver' ]));

		for (let use in uses)
			if (uci.get(CONFIG, use[0], use[1]) in [ 'dnsmasq' ])
				uci.set(CONFIG, use[0], use[1], 'local');

		uci.delete(CONFIG, 'dnsmasq');
	},

	// 8: QUIC is rejected by its sniffed protocol, one condition as the route
	// rules page has them, rather than by UDP to port 443
	(uci) => {
		uci.foreach(CONFIG, 'route_rule', (rule) => {
			const fields = filter(keys(rule), (key) => substr(key, 0, 1) != '.');
			const port = rule.port;

			if (rule.action == 'reject' && rule.network == 'udp' && length(fields) == 3 &&
			    (port == '443' || (type(port) == 'array' && length(port) == 1 && port[0] == '443'))) {
				uci.delete(CONFIG, rule['.name'], 'network');
				uci.delete(CONFIG, rule['.name'], 'port');
				uci.set(CONFIG, rule['.name'], 'protocol', [ 'quic' ]);
			}
		});
	},

	// 9: logs name the LAN devices, by their MAC address and host name
	(uci) => {
		if (uci.get(CONFIG, 'route') && uci.get(CONFIG, 'route', 'find_neighbor') == null)
			uci.set(CONFIG, 'route', 'find_neighbor', '1');
	},

	// 10: dnsmasq sends its queries to the dns inbound while sing-box runs,
	// which the tun takeover uses as well now
	(uci) => {
		if (uci.get(CONFIG, 'tun', 'enabled') == '1' && uci.get(CONFIG, 'dns_in'))
			uci.set(CONFIG, 'dns_in', 'enabled', '1');
	},

	// 11: FakeIP answers IPv6 from 2001:2::/48, the benchmarking range, for
	// fc00::/18: dnsmasq, which forwards to sing-box now, drops answers in
	// fc00::/7 as DNS rebinding. A range changed by hand stays
	(uci) => {
		if (uci.get(CONFIG, 'fakeip', 'type') == 'fakeip' && uci.get(CONFIG, 'fakeip', 'inet6_range') == 'fc00::/18')
			uci.set(CONFIG, 'fakeip', 'inet6_range', '2001:2::/48');
	},

	// 12: FakeIP answers carry a TTL of 1 second, so devices hardly cache the
	// fake addresses and get real ones again as soon as OpenBox stops. A TTL
	// set by hand stays
	(uci) => {
		for (let name in [ 'foreign', 'fallback' ])
			if (uci.get(CONFIG, name, 'server') == 'fakeip' && uci.get(CONFIG, name, 'rewrite_ttl') == null)
				uci.set(CONFIG, name, 'rewrite_ttl', '1');
	}
];

const latest = length(MIGRATIONS) + 1;
const current = uci.get(CONFIG, 'main', 'config_version');
let version = +(current ?? '1');

// a config without a version is from the first release
if (uci.get(CONFIG, 'main') && (current == null || version < latest)) {
	for (; version < latest; version++)
		MIGRATIONS[version - 1](uci);

	uci.set(CONFIG, 'main', 'config_version', `${latest}`);
	uci.save(CONFIG);
	uci.commit(CONFIG);
}
