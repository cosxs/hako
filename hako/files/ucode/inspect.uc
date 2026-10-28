#!/usr/bin/ucode
// Prints what the shell scripts need from the config sing-box runs, through
// the functions of common.sh named the same.
//
// usage: inspect.uc <running config> uses_tproxy|uses_tun_route|tproxy_port|dns_inbound|tun_route_params|dnsmasq_uid

'use strict';

import { readfile } from 'fs';
import { tproxy_inbound, dns_inbound, tun_route, tun_route_params, dnsmasq_uid } from 'hako.config';

let config = null;
try {
  config = json(readfile(ARGV[0]) ?? '');
}
catch (e) {}

switch (ARGV[1]) {
case 'uses_tproxy':
  exit(tproxy_inbound(config) ? 0 : 1);

case 'uses_tun_route':
  exit(tun_route(config) ? 0 : 1);

case 'tproxy_port':
  const port = tproxy_inbound(config)?.listen_port;
  if (port != null)
    print(port, '\n');
  break;

case 'dns_inbound':
  const dns = dns_inbound(config);
  if (dns?.port != null)
    print(dns.listen, ' ', dns.port, '\n');
  break;

case 'tun_route_params':
  print(join(' ', tun_route_params(config)), '\n');
  break;

case 'dnsmasq_uid':
  const uid = dnsmasq_uid();
  if (uid != null)
    print(uid, '\n');
  break;

default:
  warn(`hako: unknown inspection '${ARGV[1]}'\n`);
  exit(2);
}

exit(0);
