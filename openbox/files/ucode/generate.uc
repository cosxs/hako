#!/usr/bin/ucode
// Generate the sing-box configuration of a profile and print it as JSON: what
// sing-box runs comes from the profile, the UCI package openbox_<name>, and
// how it takes over traffic from the settings of the device in openbox.
//
// Naming follows sing-box wherever sing-box has the field: a section type is a
// top-level key, a section name the key below it, options are sing-box fields,
// and nested fields are joined with "_" (tls.server_name -> tls_server_name).

'use strict';

import { cursor } from 'uci';
import { readfile } from 'fs';
import { DEVICE, SUBSCRIPTION_DIR, current_profile, profile_source } from 'openbox.profile';

// OPENBOX_CONFDIR and OPENBOX_SAVEDIR point the tests at their own config
const uci = cursor(getenv('OPENBOX_CONFDIR'), getenv('OPENBOX_SAVEDIR'));
uci.load(DEVICE);

// the sections of the profile, in its own package
const SOURCE = profile_source(uci, current_profile(uci));
if (!SOURCE) {
  warn(`openbox: profile '${current_profile(uci)}' not found\n`);
  exit(1);
}

const puci = SOURCE.uci;
const PROFILE = SOURCE.package;

// the device keeps the takeover, its firewall and the clash API; everything
// else belongs to the profile
const DEVICE_TYPES = [ 'openbox', 'inbound', 'experimental' ];

function package_of(sectionType) {
  return (sectionType in DEVICE_TYPES) ? DEVICE : PROFILE;
}

function cursor_of(sectionType) {
  return (sectionType in DEVICE_TYPES) ? uci : puci;
}

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
// "hidden" is not a field: it hides a section in LuCI, and makes a group take
// all the others
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
  const section = cursor_of(sectionType).get_all(package_of(sectionType), name);
  if (!section || section['.type'] != sectionType)
    return null;

  return convert(section, fields, `${sectionType}.${name}`, refs);
}

// outbounds: proxies (direct and protocol outbounds) and groups

const GROUP_TYPES = [ 'selector', 'urltest' ];

const sections = [];
puci.foreach(PROFILE, 'outbound', (section) => {
  if (section.enabled != '0')
    push(sections, section);
});

function tag(section) {
  return section.tag || section['.name'];
}

// an option of a node written as JSON, an object of sing-box fields taken as
// it is; null when empty or not an object
function json_fields(section, option) {
  if (!section[option])
    return null;

  let fields;
  try {
    fields = json(section[option]);
  }
  catch (e) {
    warn(`openbox: outbound ${section['.name']}: skipping ${option}: ${e}\n`);
    return null;
  }

  if (type(fields) != 'object') {
    warn(`openbox: outbound ${section['.name']}: skipping ${option}: not an object\n`);
    return null;
  }

  return fields;
}

// tls_fields: more TLS fields written as JSON, which go over the options
function tls(section, required) {
  if (!required && !bool(section.tls_enabled))
    return null;

  const reality = bool(section.tls_reality_enabled);
  const fingerprint = section.tls_utls_fingerprint || (reality ? 'chrome' : null);

  return merge({
    enabled: true,
    server_name: section.tls_server_name,
    insecure: bool(section.tls_insecure) || null,
    utls: fingerprint ? { enabled: true, fingerprint: fingerprint } : null,
    reality: reality ? {
      enabled: true,
      public_key: section.tls_reality_public_key,
      short_id: section.tls_reality_short_id
    } : null
  }, json_fields(section, 'tls_fields'));
}

// headers, as transport_headers and the extra_headers of naive: "Name:
// value" items; a name given more than once has a list of values
function headers(section, option) {
  let result = null;

  for (let item in list(section[option])) {
    const m = match(item, /^([^:]+):(.*)$/);
    const name = m ? trim(m[1]) : null;
    if (!name) {
      warn(`openbox: outbound ${section['.name']}: skipping ${option} '${item}': expecting "Name: value"\n`);
      continue;
    }

    const value = trim(m[2]);
    result ??= {};
    if (result[name] == null)
      result[name] = value;
    else if (type(result[name]) == 'array')
      push(result[name], value);
    else
      result[name] = [ result[name], value ];
  }

  return result;
}

// transport_host is a list for http; httpupgrade takes the first host
function transport(section) {
  const hosts = list(section.transport_host);

  switch (section.transport_type) {
  case 'http':
    return {
      type: 'http',
      host: length(hosts) ? hosts : null,
      path: section.transport_path,
      method: section.transport_method,
      headers: headers(section, 'transport_headers')
    };

  case 'ws':
    return {
      type: 'ws',
      path: section.transport_path,
      headers: headers(section, 'transport_headers')
    };

  case 'httpupgrade':
    return { type: 'httpupgrade', host: hosts[0], path: section.transport_path, headers: headers(section, 'transport_headers') };

  case 'grpc':
    return { type: 'grpc', service_name: section.transport_service_name };

  case 'quic':
    return { type: 'quic' };
  }

  return null;
}

// multiplex, for shadowsocks, vmess, vless and trojan
function multiplex(section) {
  if (!bool(section.multiplex_enabled))
    return null;

  return {
    enabled: true,
    protocol: section.multiplex_protocol,
    max_connections: number(section.multiplex_max_connections),
    min_streams: number(section.multiplex_min_streams),
    max_streams: number(section.multiplex_max_streams),
    padding: bool(section.multiplex_padding) || null,
    brutal: bool(section.multiplex_brutal_enabled) ? {
      enabled: true,
      up_mbps: number(section.multiplex_brutal_up_mbps),
      down_mbps: number(section.multiplex_brutal_down_mbps)
    } : null
  };
}

// hysteria2 hops over port ranges instead of one port
function hopping(section) {
  const ranges = list(section.server_ports);
  if (!length(ranges))
    return {};

  return {
    server_port: null,
    server_ports: ranges,
    hop_interval: section.hop_interval,
    hop_interval_max: section.hop_interval_max
  };
}

// a size such as 6MB or 64 MB, or a number of bytes
function size(value) {
  return match(value ?? '', /^[0-9]+$/) ? int(value) : value;
}

// the QUIC fields of hysteria2 and tuic
function quic(section) {
  return {
    initial_packet_size: number(section.initial_packet_size),
    disable_path_mtu_discovery: bool(section.disable_path_mtu_discovery) || null,
    idle_timeout: section.idle_timeout,
    keep_alive_period: section.keep_alive_period,
    stream_receive_window: size(section.stream_receive_window),
    connection_receive_window: size(section.connection_receive_window),
    max_concurrent_streams: number(section.max_concurrent_streams)
  };
}

// a hysteria2 server reached through a realm instead of its address; the
// http client is a reference, turned into its tag once those are known
function realm(section) {
  if (!section.realm_server_url)
    return null;

  return {
    server_url: section.realm_server_url,
    token: section.realm_token,
    realm_id: section.realm_realm_id,
    stun_servers: nonempty(section.realm_stun_servers),
    ip_version: number(section.realm_ip_version),
    port_mapping: bool(section.realm_port_mapping_enabled) ? {
      enabled: true,
      timeout: section.realm_port_mapping_timeout,
      lifetime: section.realm_port_mapping_lifetime
    } : null,
    http_client: section.realm_http_client
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

  case 'shadowsocks':
    return merge(outbound, {
      method: section.method,
      password: section.password,
      plugin: section.plugin,
      plugin_opts: section.plugin ? section.plugin_opts : null,
      network: section.network,
      udp_over_tcp: bool(section.udp_over_tcp) || null,
      multiplex: multiplex(section)
    });

  case 'vmess':
    return merge(outbound, {
      uuid: section.uuid,
      security: section.security,
      alter_id: number(section.alter_id),
      global_padding: bool(section.global_padding) || null,
      authenticated_length: bool(section.authenticated_length) || null,
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
      network: section.network,
      tls: tls(section),
      transport: transport(section),
      multiplex: multiplex(section)
    });

  case 'trojan':
    return merge(outbound, {
      password: section.password,
      network: section.network,
      tls: tls(section),
      transport: transport(section),
      multiplex: multiplex(section)
    });

  // a realm takes the place of the address of the server
  case 'hysteria2': {
    const gecko = (section.obfs_type == 'gecko');
    const via = realm(section);

    return merge(merge(merge(outbound, {
      password: section.password,
      up_mbps: number(section.up_mbps),
      down_mbps: number(section.down_mbps),
      obfs: section.obfs_password ? {
        type: section.obfs_type || 'salamander',
        password: section.obfs_password,
        min_packet_size: gecko ? number(section.obfs_min_packet_size) : null,
        max_packet_size: gecko ? number(section.obfs_max_packet_size) : null
      } : null,
      network: section.network,
      bbr_profile: section.bbr_profile,
      brutal_debug: bool(section.brutal_debug) || null,
      disable_chrome_parrot: bool(section.disable_chrome_parrot) || null,
      realm: via,
      tls: tls(section, true)
    }), quic(section)), via ? { server: null, server_port: null } : hopping(section));
  }

  case 'tuic':
    return merge(merge(outbound, {
      uuid: section.uuid,
      password: section.password,
      congestion_control: section.congestion_control,
      udp_relay_mode: section.udp_relay_mode,
      udp_over_stream: bool(section.udp_over_stream) || null,
      zero_rtt_handshake: bool(section.zero_rtt_handshake) || null,
      heartbeat: section.heartbeat,
      network: section.network,
      tls: tls(section, true)
    }), quic(section));

  case 'anytls':
    return merge(outbound, {
      password: section.password,
      idle_session_check_interval: section.idle_session_check_interval,
      idle_session_timeout: section.idle_session_timeout,
      min_idle_session: number(section.min_idle_session),
      client_metadata: section.client_metadata,
      tls: tls(section, true)
    });

  // naive takes the server name only from the tls fields
  // the QUIC options count with quic only; a window is a size such as 6MB,
  // or a number of bytes
  case 'naive': {
    const over_quic = bool(section.quic);

    return merge(outbound, {
      username: section.username,
      password: section.password,
      insecure_concurrency: number(section.insecure_concurrency),
      extra_headers: headers(section, 'extra_headers'),
      stream_receive_window: size(section.stream_receive_window),
      udp_over_tcp: bool(section.udp_over_tcp) || null,
      quic: over_quic || null,
      quic_congestion_control: over_quic ? section.quic_congestion_control : null,
      quic_session_receive_window: over_quic ? size(section.quic_session_receive_window) : null,
      tls: merge({ enabled: true, server_name: section.tls_server_name }, json_fields(section, 'tls_fields'))
    });
  }

  // version 4 obfuscates as HTTP, version 6 shapes traffic instead
  case 'snell': {
    const version = number(section.version);

    return merge(outbound, {
      version: version,
      psk: section.psk,
      userkey: section.userkey,
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
      // PEM written in one text, given as its lines
      private_key: section.private_key ? filter(split(section.private_key, '\n'), (line) => trim(line) != '') : null,
      private_key_path: section.private_key_path,
      private_key_passphrase: section.private_key_passphrase,
      host_key: nonempty(section.host_key),
      host_key_algorithms: nonempty(section.host_key_algorithms),
      client_version: section.client_version,
      cipher: nonempty(section.cipher),
      mac: nonempty(section.mac),
      kex_algorithm: nonempty(section.kex_algorithm)
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
      headers: headers(section, 'headers'),
      tls: tls(section)
    });
  }

  warn(`openbox: skipping outbound ${section['.name']}: unsupported type '${section.type}'\n`);
  return null;
}

const groups = filter(sections, (section) => section.type in GROUP_TYPES);

const proxyOutbounds = [];
const proxies = [];
const proxyObjects = [];
for (let section in sections) {
  if (section.type in GROUP_TYPES)
    continue;

  const outbound = proxy_outbound(section);
  if (outbound) {
    push(proxyOutbounds, outbound);
    push(proxies, section);
    push(proxyObjects, outbound);
  }
}

// a profile made from a subscription takes its nodes from what the
// subscription downloaded: the outbounds and endpoints that are no groups,
// direct, block or dns; a tag the profile has already is skipped
const NOT_NODES = [ 'direct', 'block', 'dns', 'selector', 'urltest' ];
const subNodes = [];

if (puci.get(PROFILE, 'profile', 'url')) {
  let sub = null;
  try {
    sub = json(readfile(`${SUBSCRIPTION_DIR}/${current_profile(uci)}.json`) ?? '');
  }
  catch (e) {}

  if (type(sub) != 'object')
    warn('openbox: the subscription of the profile has not been downloaded\n');

  const taken = {};
  for (let section in sections)
    taken[tag(section)] = true;

  for (let kind in [ 'outbounds', 'endpoints' ]) {
    for (let node in sub?.[kind] ?? []) {
      if (type(node) != 'object' || type(node.tag) != 'string' || node.type in NOT_NODES)
        continue;

      if (taken[node.tag]) {
        warn(`openbox: skipping node '${node.tag}' of the subscription: the profile has an outbound of that name\n`);
        continue;
      }

      taken[node.tag] = true;
      push(subNodes, { tag: node.tag, type: node.type, node: node, endpoint: kind == 'endpoints' });
    }
  }

  // a node connects through another node only; groups of the subscription
  // are not taken
  const nodeTags = map(subNodes, (n) => n.tag);
  for (let n in subNodes) {
    if (n.node.detour != null && !(n.node.detour in nodeTags)) {
      warn(`openbox: node '${n.tag}' of the subscription: dropping detour '${n.node.detour}', not a node\n`);
      delete n.node.detour;
    }
  }
}

function sub_node(ref) {
  return filter(subNodes, (n) => n.tag == ref)[0];
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
  return section ? tag(section) : sub_node(ref)?.tag;
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
puci.foreach(PROFILE, 'dns_server', (section) => {
  if (section.enabled != '0')
    push(dnsServers, section);
});

function resolve_dns(ref) {
  const section = find(dnsServers, ref);
  return section ? tag(section) : null;
}

// dial fields of nodes, written as JSON in dial_fields; a node may connect
// through another one with a detour
for (let i = 0; i < length(proxies); i++)
  if (proxies[i].type != 'direct')
    merge(proxyObjects[i], json_fields(proxies[i], 'dial_fields'));

// the groups a group takes: those it lists, and every group not hidden for
// a hidden one, as the one of the global mode
function group_refs(group) {
  const refs = [];
  for (let ref in list(group.outbounds)) {
    const member = find(groups, ref);
    if (member && member != group)
      push(refs, member);
  }

  if (bool(group.hidden))
    for (let other in groups)
      if (other != group && !bool(other.hidden))
        push(refs, other);

  return refs;
}

const groupRefs = {};
for (let group in groups)
  groupRefs[group['.name']] = group_refs(group);

// the way from a group to another through the groups they take, or null
function group_path(from, to, seen) {
  if (from == to)
    return [ from ];

  seen ??= {};
  if (seen[from['.name']])
    return null;

  seen[from['.name']] = true;
  for (let next in groupRefs[from['.name']]) {
    const rest = group_path(next, to, seen);
    if (rest)
      return [ from, ...rest ];
  }

  return null;
}

// the members in the order of outbounds, as listed in LuCI. A hidden group,
// as the one of the global mode, then takes everything else: the nodes, then
// Direct, a hidden node, then every group not hidden; not the shadowtls nodes
// a subscription may have, which only carry another node. A group listed
// that already contains this one, directly or through others, is dropped:
// sing-box checks such a loop only when it starts, and then fails. So none
// takes a hidden one either
function group_members(group) {
  const listed = [], nodes = [], direct = [], members = [];
  const where = `outbound ${group['.name']}`;

  for (let ref in list(group.outbounds)) {
    const member = find(groups, ref) ?? find(proxies, ref);
    const loop = (member && member != group && member.type in GROUP_TYPES) ? group_path(member, group) : null;
    if (loop)
      warn(`openbox: ${where}: dropping '${ref}': it contains this group (${join(' -> ', map(loop, tag))}), a loop\n`);
    else if (member && member != group)
      push(listed, tag(member));
    else if (sub_node(ref))
      push(listed, ref);
  }

  if (bool(group.hidden)) {
    for (let proxy in [ ...proxies, ...subNodes ])
      if (proxy.type != 'shadowtls')
        push(proxy.type == 'direct' ? direct : nodes, tag(proxy));

    for (let other in groups)
      if (!bool(other.hidden))
        push(members, tag(other));
  }

  const result = uniq([ ...listed, ...nodes, ...direct, ...members ]);
  if (!length(result))
    warn(`openbox: ${where} has no outbounds\n`);

  return result;
}

function group_outbound(group) {
  const members = group_members(group);
  const outbound = {
    type: group.type,
    tag: tag(group),
    outbounds: members,
    interrupt_exist_connections: bool(group.interrupt_exist_connections) || null
  };

  // an auto group without a test URL of its own takes the one of the
  // plugin settings
  if (group.type == 'urltest')
    return merge(outbound, {
      url: group.url || uci.get(DEVICE, 'latency', 'url'),
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

// a node of a subscription resolves its server with the DNS servers of the
// profile: one of the subscription's own is dropped, so the default resolver
// of the route does it
const dnsServerTags = map(dnsServerObjects, (server) => server.tag);
for (let n in subNodes) {
  const resolver = n.node.domain_resolver;
  const server = (type(resolver) == 'object') ? resolver.server : resolver;
  if (server != null && !(server in dnsServerTags))
    delete n.node.domain_resolver;
}

// http clients and rule sets

function enabled_sections(sectionType) {
  const result = [];
  cursor_of(sectionType).foreach(package_of(sectionType), sectionType, (section) => {
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

// the http client of a hysteria2 realm, by its tag
for (let object in proxyObjects)
  if (object.realm && object.realm.http_client)
    object.realm.http_client = resolve_http_client(object.realm.http_client);

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
const mode = uci.get(DEVICE, 'main', 'mode') ?? uci.get(DEVICE, 'clash_api', 'default_mode') ?? '';
if (lc(mode) == 'global')
  for (let inbound in inbounds)
    delete inbound.route_exclude_address_set;

// with tproxy, OpenBox sets up the firewall and skips connections carrying
// this mark, so sing-box marks its own
function default_mark() {
  for (let inbound in inbounds) {
    if (inbound.type == 'tproxy') {
      // "+" also reads hexadecimal such as 0x6f63
      const mark = +(uci.get(DEVICE, 'firewall', 'output_mark') ?? '');
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
  const text = puci.get(PROFILE, 'dns', 'custom_rules');
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
    ...map(filter(subNodes, (n) => !n.endpoint), (n) => n.node),
    ...groupOutbounds
  ],
  // only the nodes of a subscription may be endpoints
  endpoints: length(filter(subNodes, (n) => n.endpoint))
    ? map(filter(subNodes, (n) => n.endpoint), (n) => n.node) : null,
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
