'use strict';
'require baseclass';
'require uci';
'require hako.ui as hako';

// the node types the generator supports
const NODE_TYPES = {
  shadowsocks: 'Shadowsocks',
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
  anytls: 'AnyTLS',
  naive: 'NaiveProxy',
  snell: 'Snell',
  ssh: 'SSH',
  socks: 'SOCKS',
  http: 'HTTP'
};

// TLS is optional for some types and always on for others; naive takes the
// server name only, and uTLS works over TCP only
const TLS_OPTIONAL = ['vmess', 'vless', 'trojan', 'http'];
const TLS_REQUIRED = ['hysteria2', 'tuic', 'anytls', 'naive'];
const UTLS_TYPES = ['vmess', 'vless', 'trojan', 'http', 'anytls'];
const MULTIPLEX_TYPES = ['shadowsocks', 'vmess', 'vless', 'trojan'];
const QUIC_TYPES = ['hysteria2', 'tuic'];
// the protocols that take no node without a password
const PASSWORD_REQUIRED = ['shadowsocks', 'trojan', 'anytls'];

const SS_METHODS = [
  '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
  'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
  'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305', 'none'
];

const UTLS_FINGERPRINTS = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'];

// a tag is shared by groups and nodes and must be unique among all outbounds
function validateTag(section_id, value) {
  if (value == 'GLOBAL')
    return _('GLOBAL is reserved by the clash API.');

  if (uci.sections(hako.profileConfig(), 'outbound').some((section) => section['.name'] != section_id && hako.label(section) == value))
    return _('Another outbound already uses this name.');

  return true;
}

// the depends of a field on the protocols it shows for, all by default
function remote(option, types) {
  (types ?? Object.keys(NODE_TYPES)).forEach((type) => option.depends('type', type));
}

// the same for the address of the server, which a hysteria2 server reached
// through a realm has not
function address(option, types) {
  (types ?? Object.keys(NODE_TYPES)).forEach((type) =>
    option.depends((type == 'hysteria2') ? { type: type, realm_server_url: '' } : { type: type }));
}

// what the policy page and the dialog of a node share
return baseclass.extend({
  NODE_TYPES,
  TLS_OPTIONAL,
  TLS_REQUIRED,
  UTLS_TYPES,
  MULTIPLEX_TYPES,
  QUIC_TYPES,
  PASSWORD_REQUIRED,
  SS_METHODS,
  UTLS_FINGERPRINTS,
  validateTag,
  remote,
  address
});
