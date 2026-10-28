#!/usr/bin/ucode
// Print the nftables rules Hako sets up around sing-box. DNS from the LAN goes
// to the dns inbound, also queries to the router itself, which no tun takes
// over, and so do the router's own queries; dnsmasq is left as it is, the
// resolver the local DNS server of sing-box asks. With the tproxy
// inbound, LAN traffic and the router's own traffic go to it, and bypassed
// destinations never reach sing-box; sing-box sets up its own rules for the
// tun inbound. IPv6 is taken over the same way with firewall.ipv6; otherwise
// IPv6 connections are refused, so clients fall back to IPv4.
//
// Usage: firewall.uc <running config>
// Ports and the mark of sing-box's own connections come from the config
// sing-box runs, so the rules always match it; interfaces, bypassed
// addresses and the routing marks come from UCI. Rule sets are matched by
// sing-box itself, as its routes and DNS rules use them.

'use strict';

import { cursor } from 'uci';
import { connect } from 'ubus';
import { readfile } from 'fs';
import { DEVICE } from 'hako.profile';
import { tun_route, tun_route_params, dnsmasq_uid } from 'hako.config';

const RUN_CONFIG = ARGV[0];

const uci = cursor();
uci.load(DEVICE);

function list(value) {
  if (type(value) == 'array')
    return value;

  return (value != null && value != '') ? [ value ] : [];
}

// "+" also reads hexadecimal marks such as 0x6f62
function mark(name) {
  const value = +(uci.get(DEVICE, 'firewall', name) ?? '');
  return (value > 0) ? sprintf('0x%x', value) : null;
}

let running = null;
try {
  running = json(readfile(RUN_CONFIG) ?? '');
}
catch (e) {}

// the listen port of an inbound in the running config: the one with the
// given tag, or else the first of the type
function port(inboundType, preferredTag) {
  const candidates = filter(running?.inbounds ?? [], (inbound) => inbound.type == inboundType && inbound.listen_port > 0);
  const preferred = filter(candidates, (inbound) => inbound.tag == preferredTag);

  return (preferred[0] ?? candidates[0])?.listen_port;
}

// LAN interfaces to their devices, e.g. lan -> br-lan; an interface that is
// not up yet falls back to its configured device, and hotplug sets the rules
// up again once it is
function devices() {
  const ubus = connect();
  const result = [];

  uci.load('network');

  for (let name in list(uci.get(DEVICE, 'firewall', 'interface'))) {
    const status = ubus.call('network.interface', 'status', { interface: name });
    const device = status?.l3_device ?? status?.device ?? uci.get('network', name, 'device');
    if (device)
      push(result, device);
    else
      warn(`hako: interface '${name}' has no device\n`);
  }

  ubus.disconnect();
  return uniq(result);
}

const fwmark = mark('mark');
const outputMark = (running?.route?.default_mark > 0) ? sprintf('0x%x', running.route.default_mark) : null;
const tproxyPort = port('tproxy');
const dnsPort = port('direct', 'dns-in');

if (!tproxyPort && !dnsPort) {
  warn('hako: firewall needs a tproxy or dns inbound in the running config\n');
  exit(1);
}

if (tproxyPort && (!fwmark || !outputMark)) {
  warn('hako: tproxy needs firewall.mark, and route.default_mark in the running config\n');
  exit(1);
}

const lan = devices();
const ipv6 = uci.get(DEVICE, 'firewall', 'ipv6') == '1';

const bypass = list(uci.get(DEVICE, 'firewall', 'bypass_address'));
const bypass6 = list(uci.get(DEVICE, 'firewall', 'bypass_address6'));

function elements(values) {
  return length(values) ? `elements = { ${join(', ', values)} }` : '';
}

// destinations that stay with the system: replies, the router itself,
// broadcast and multicast, bypassed addresses; DNS is handled by dstnat
const SKIP = `
    ct direction reply return${ipv6 ? '' : `
    meta nfproto != ipv4 return`}
    meta l4proto { tcp, udp } th dport 53 return
    fib daddr type { local, broadcast, multicast } return
    ip daddr @bypass return${ipv6 ? `
    ip6 daddr @bypass6 return` : ''}`;

// connections marked in output come back on lo, LAN connections come in on
// the LAN: both go to the tproxy inbound, for IPv6 as well with ipv6
const TPROXY_LO = `
    iifname "lo" meta mark ${fwmark} meta nfproto ipv4 meta l4proto { tcp, udp } tproxy ip to :${tproxyPort} accept${ipv6 ? `
    iifname "lo" meta mark ${fwmark} meta nfproto ipv6 meta l4proto { tcp, udp } tproxy ip6 to :${tproxyPort} accept` : ''}`;

const TPROXY_LAN = `
    meta nfproto ipv4 meta l4proto { tcp, udp } meta mark set ${fwmark} tproxy ip to :${tproxyPort} accept${ipv6 ? `
    meta nfproto ipv6 meta l4proto { tcp, udp } meta mark set ${fwmark} tproxy ip6 to :${tproxyPort} accept` : ''}`;

print(`table inet hako {
  set lan {
    type ifname
    ${elements(map(lan, (device) => `"${device}"`))}
  }
`);

if (tproxyPort)
  print(`
  set bypass {
    type ipv4_addr
    flags interval
    auto-merge
    ${elements(bypass)}
  }

  set bypass6 {
    type ipv6_addr
    flags interval
    auto-merge
    ${elements(bypass6)}
  }

  chain prerouting {
    type filter hook prerouting priority mangle; policy accept;${TPROXY_LO}
    iifname != @lan return${SKIP}${TPROXY_LAN}
  }

  chain output {
    type route hook output priority mangle; policy accept;
    meta mark ${outputMark} return${SKIP}
    meta l4proto { tcp, udp } meta mark set ${fwmark}
  }
`);

// without ipv6 only IPv4 is taken over: IPv6 connections from the LAN and
// the router are refused, so they fall back to IPv4 instead of going out
// directly
if (tproxyPort && !ipv6)
  print(`
  chain forward_ipv6 {
    type filter hook forward priority filter; policy accept;
    iifname != @lan return
    meta nfproto ipv6 meta l4proto { tcp, udp } ip6 daddr != @bypass6 reject with icmpx no-route
  }

  chain output_ipv6 {
    type filter hook output priority filter; policy accept;
    meta mark ${outputMark} return
    meta nfproto ipv6 meta l4proto { tcp, udp } fib daddr type != local ip6 daddr != @bypass6 reject with icmpx no-route
  }
`);

// DNS from the LAN goes to the dns inbound: with tproxy all of it, with tun
// what is sent to the router itself, as the tun hijacks the rest
if (dnsPort)
  print(`
  chain dstnat {
    type nat hook prerouting priority dstnat; policy accept;
    iifname @lan ${tproxyPort ? '' : 'fib daddr type local '}meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}
  }
`);

// the router's own queries go to the dns inbound as well, as the system DNS
// of a device points at the proxy: those to dnsmasq on loopback, and with
// tproxy those to any other server, which a tun hijacks itself. Left out are
// the queries of sing-box, which carry the mark of its own connections, and
// those of dnsmasq to its upstream servers: the local DNS server asks
// dnsmasq, and either would come back to sing-box. A tun marks the
// connections of sing-box with auto_redirect only; without it, they cannot
// be told apart from the router's own, which stay with dnsmasq
const dnsmasqUid = dnsmasq_uid();
const tun = tun_route(running);
const ownMark = tproxyPort ? outputMark : (tun?.auto_redirect ? tun_route_params(running)[3] : null);

if (dnsPort && ownMark)
  print(`
  chain nat_output {
    type nat hook output priority -100; policy accept;
    meta mark ${ownMark} return${dnsmasqUid != null ? `
    meta skuid ${dnsmasqUid} return` : ''}${tproxyPort ? `
    meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}` : `
    ip daddr 127.0.0.0/8 meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}
    ip6 daddr ::1 meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}`}
  }
`);

// redirected to loopback, the queries tproxy takes to other servers keep
// their source address, such as the WAN address; sing-box listens on all
// addresses and answers from that one, which does not match the redirect, so
// they are sent from loopback
if (dnsPort && tproxyPort)
  print(`
  chain nat_postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "lo" ct status dnat meta l4proto { tcp, udp } th dport ${dnsPort} ip saddr != 127.0.0.0/8 snat ip to 127.0.0.1
    oifname "lo" ct status dnat meta l4proto { tcp, udp } th dport ${dnsPort} ip6 saddr != ::1 snat ip6 to ::1
  }
`);

print('}\n');
