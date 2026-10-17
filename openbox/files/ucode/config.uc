// Reads the inbounds of a sing-box config that OpenBox sets up around
// sing-box, shared by inspect.uc (for the shell scripts) and the rpcd plugin
// of LuCI.
//
// import { tproxy_inbound, dns_inbound, tun_route, tun_route_params } from 'openbox.config';

'use strict';

function first_inbound(config, wanted) {
	for (let inbound in config?.inbounds ?? [])
		if (wanted(inbound))
			return inbound;

	return null;
}

// the (first) tproxy inbound, which needs the firewall OpenBox sets up
function tproxy_inbound(config) {
	return first_inbound(config, (inbound) => inbound.type == 'tproxy');
}

// the dns inbound, the direct one tagged dns-in: its listen address, as
// dnsmasq reaches it, and port
function dns_inbound(config) {
	const inbound = first_inbound(config, (inbound) => inbound.type == 'direct' && inbound.tag == 'dns-in');
	if (!inbound)
		return null;

	const listen = inbound.listen;

	return {
		tag: inbound.tag,
		listen: (!listen || listen in [ '::', '0.0.0.0' ]) ? '127.0.0.1' : listen,
		port: inbound.listen_port
	};
}

// the (first) tun inbound that sets up routes and nftables rules
function tun_route(config) {
	return first_inbound(config, (inbound) => inbound.type == 'tun' && inbound.auto_route === true);
}

// the route table, rule priority, input and output marks and fallback rule
// priority of that tun inbound, or sing-box's defaults; marks may be written
// as numbers or hex strings, ip prints them in hex
function tun_route_params(config) {
	const tun = tun_route(config) ?? {};

	return [
		tun.iproute2_table_index ?? 2022,
		tun.iproute2_rule_index ?? 9000,
		sprintf('0x%x', +(tun.auto_redirect_input_mark ?? 0x2023)),
		sprintf('0x%x', +(tun.auto_redirect_output_mark ?? 0x2024)),
		tun.auto_redirect_iproute2_fallback_rule_index ?? 32768
	];
}

export { tproxy_inbound, dns_inbound, tun_route, tun_route_params };
