#!/usr/bin/ucode
// Print the nftables rules for taking over traffic with the tproxy inbound.
// sing-box sets up its own rules for the tun inbound, so this only covers
// tproxy: LAN traffic and the router's own traffic go to the tproxy inbound,
// DNS goes to the dns inbound, and bypassed destinations never reach sing-box.
// IPv6 is taken over the same way with firewall.ipv6; otherwise IPv6
// connections are refused, so clients fall back to IPv4.
//
// Usage: firewall.uc <running config> <work dir>
// Ports and the mark of sing-box's own connections come from the config
// sing-box runs, so the rules always match it; interfaces, bypassed
// destinations and the routing marks come from UCI. The work dir holds
// decompiled rule sets.

'use strict';

import { cursor } from 'uci';
import { connect } from 'ubus';
import { readfile, unlink } from 'fs';
import { DEVICE, current_profile, profile_source } from 'hako.profile';

const CORE = '/usr/bin/sing-box';
const RUN_CONFIG = ARGV[0];
const WORK_DIR = ARGV[1] ?? '/tmp';

const uci = cursor();
uci.load(DEVICE);

// rule sets belong to the profile in use
const SOURCE = profile_source(uci, current_profile(uci));

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

// a rule set section by name or tag
function rule_set(ref) {
  let found = null;

  if (!SOURCE)
    return null;

  SOURCE.uci.foreach(SOURCE.package, 'rule_set', (section) => {
    if (!found && (section['.name'] == ref || section.tag == ref))
      found = section;
  });

  return found;
}

// the IPv4 and IPv6 CIDRs of a local binary or source rule set
function rule_set_cidrs(ref) {
  const result = { ipv4: [], ipv6: [] };

  const section = rule_set(ref);
  if (!section || section.enabled == '0') {
    warn(`hako: unknown rule_set '${ref}'\n`);
    return result;
  }

  if (!(section.type in [ 'local', 'inline' ]) || (section.type == 'local' && !section.path)) {
    warn(`hako: rule_set '${ref}': only local and inline rule sets can be bypassed in the firewall\n`);
    return result;
  }

  // an inline rule set has its rules in UCI, as a JSON array
  let content = null;
  if (section.type == 'inline') {
    content = `{ "rules": ${section.rules ?? '[]'} }`;
  }
  else if (section.format == 'source' || (!section.format && match(section.path, /\.json$/))) {
    content = readfile(section.path);
  }
  else {
    const output = `${WORK_DIR}/rule-set-${section['.name']}.json`;
    if (system(`${CORE} rule-set decompile ${section.path} -o ${output} >/dev/null 2>&1`) == 0)
      content = readfile(output);
    unlink(output);
  }

  let source = null;
  try {
    source = json(content ?? '');
  }
  catch (e) {}

  if (!source) {
    warn(`hako: rule_set '${ref}': cannot read ${section.path}\n`);
    return result;
  }

  for (let rule in ((type(source.rules) == 'object') ? [ source.rules ] : (source.rules ?? [])))
    for (let cidr in list(rule.ip_cidr))
      push((index(cidr, ':') < 0) ? result.ipv4 : result.ipv6, cidr);

  return result;
}

const fwmark = mark('mark');
const outputMark = (running?.route?.default_mark > 0) ? sprintf('0x%x', running.route.default_mark) : null;
const tproxyPort = port('tproxy');
const dnsPort = port('direct', 'dns-in');

if (!fwmark || !outputMark || !tproxyPort) {
  warn('hako: firewall needs firewall.mark, and a tproxy inbound and route.default_mark in the running config\n');
  exit(1);
}

const lan = devices();
const ipv6 = uci.get(DEVICE, 'firewall', 'ipv6') == '1';

let bypass = list(uci.get(DEVICE, 'firewall', 'bypass_address'));
let bypass6 = list(uci.get(DEVICE, 'firewall', 'bypass_address6'));

// in Global mode every connection goes through sing-box, so the rule sets do
// not bypass it; switching the mode keeps it in main.mode
const mode = uci.get(DEVICE, 'main', 'mode') ?? uci.get(DEVICE, 'clash_api', 'default_mode') ?? '';
if (lc(mode) != 'global') {
  for (let ref in list(uci.get(DEVICE, 'firewall', 'bypass_rule_set'))) {
    const cidrs = rule_set_cidrs(ref);

    bypass = [ ...bypass, ...cidrs.ipv4 ];
    if (ipv6)
      bypass6 = [ ...bypass6, ...cidrs.ipv6 ];
  }
}

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

  set lan {
    type ifname
    ${elements(map(lan, (device) => `"${device}"`))}
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
if (!ipv6)
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

// DNS from the LAN and from the router goes to the dns inbound. The router's
// own queries keep their source address, such as the WAN address, when
// redirected to loopback; sing-box listens on all addresses and answers from
// that one, which does not match the redirect, so they are sent from loopback
if (dnsPort)
  print(`
  chain dstnat {
    type nat hook prerouting priority dstnat; policy accept;
    iifname @lan meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}
  }

  chain nat_output {
    type nat hook output priority -100; policy accept;
    meta mark ${outputMark} return
    ip daddr 127.0.0.0/8 return
    ip6 daddr ::1 return
    meta l4proto { tcp, udp } th dport 53 redirect to :${dnsPort}
  }

  chain nat_postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    oifname "lo" ct status dnat meta l4proto { tcp, udp } th dport ${dnsPort} ip saddr != 127.0.0.0/8 snat ip to 127.0.0.1
    oifname "lo" ct status dnat meta l4proto { tcp, udp } th dport ${dnsPort} ip6 saddr != ::1 snat ip6 to ::1
  }
`);

print('}\n');
