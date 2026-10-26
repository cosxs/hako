import { z } from 'zod'

import { DURATION, durationField, list } from '@/lib/outbounds'
import type { UciSection } from '@/lib/uci'

// the fields of the dialog of a node, as the LuCI one has them, in the order
// of the sing-box docs: each by its UCI option, the tab it is on, and when it
// shows. A switch is '1' or '', a list an array, the rest strings

export type NodeValues = Record<string, string | string[]>

export const NODE_PROTOCOLS: Record<string, string> = {
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
  http: 'HTTP',
}

// TLS is optional for some protocols and always on for others; naive takes
// the server name only, and uTLS works over TCP only
const TLS_OPTIONAL = ['vmess', 'vless', 'trojan', 'http']
const TLS_REQUIRED = ['hysteria2', 'tuic', 'anytls', 'naive']
const UTLS_TYPES = ['vmess', 'vless', 'trojan', 'http', 'anytls']
const MULTIPLEX_TYPES = ['shadowsocks', 'vmess', 'vless', 'trojan']
const QUIC_TYPES = ['hysteria2', 'tuic']
const TRANSPORT_TYPES = ['vmess', 'vless', 'trojan']
const PASSWORD_REQUIRED = ['shadowsocks', 'trojan', 'anytls']

export const SS_METHODS = [
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  'none',
]

const UTLS_FINGERPRINTS = ['chrome', 'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized']

export const TABS = {
  general: '基本',
  tls: 'TLS',
  transport: '传输',
  multiplex: '多路复用',
  quic: 'QUIC',
  dial: '拨号',
} as const

export type Tab = keyof typeof TABS

// the tabs of a protocol, those with fields for it
export function nodeTabs(type: string): Tab[] {
  const tabs: Tab[] = ['general']
  if (TLS_OPTIONAL.includes(type) || TLS_REQUIRED.includes(type)) tabs.push('tls')
  if (TRANSPORT_TYPES.includes(type)) tabs.push('transport')
  if (MULTIPLEX_TYPES.includes(type)) tabs.push('multiplex')
  if (QUIC_TYPES.includes(type)) tabs.push('quic')
  tabs.push('dial')
  return tabs
}

type Kind = 'text' | 'password' | 'select' | 'switch' | 'list' | 'textarea' | 'json'

export type NodeField = {
  // the key in the form, which is the UCI option unless two fields share one
  key: string
  option: string
  label: string
  tab: Tab
  kind: Kind
  show: (v: NodeValues) => boolean
  // under More options
  more?: boolean
  // of 6 columns
  span?: 2 | 3 | 4 | 6
  choices?: [string, string][]
  placeholder?: string
  unit?: string
  // a duration shown as a whole number of the unit
  duration?: 's' | 'm'
  mono?: boolean
  // needed when shown
  required?: boolean | ((v: NodeValues) => boolean)
  // a check of a value set; of each item of a list
  check?: (value: string) => boolean
  // what a new node starts with
  initial?: string
  // kept when the field hides, as another field shares its option
  retain?: boolean
  description?: string
}

const str = (v: NodeValues, key: string) => (typeof v[key] === 'string' ? (v[key] as string) : '')
const is = (...types: string[]) => (v: NodeValues) => types.includes(str(v, 'type'))
const on = (v: NodeValues, key: string) => str(v, key) === '1'
// the server of a hysteria2 node reached through a realm has no address
const addressed = (v: NodeValues) => str(v, 'type') !== 'hysteria2' || !str(v, 'realm_server_url')
const realm = (v: NodeValues) => str(v, 'type') === 'hysteria2' && !!str(v, 'realm_server_url')
const tlsOn = (v: NodeValues) => TLS_REQUIRED.includes(str(v, 'type')) || (TLS_OPTIONAL.includes(str(v, 'type')) && on(v, 'tls_enabled'))
const multiplexOn = (v: NodeValues) => MULTIPLEX_TYPES.includes(str(v, 'type')) && on(v, 'multiplex_enabled')
const always = () => true

const uint = (value: string) => /^\d+$/.test(value)
const host = (value: string) => /^[^\s/]+$/.test(value)
const size = (value: string) => /^[0-9]+( ?[KMGT]?B)?$/.test(value)
const header = (value: string) => /^[^:]*[^:\s][^:]*:/.test(value)
const url = (value: string) => /^https?:\/\/\S+$/.test(value)
const duration = (value: string) => uint(value) || DURATION.test(value)
const port = (value: string) => uint(value) && Number(value) >= 1 && Number(value) <= 65535

const DURATION_HINT = { duration: 's' as const, unit: '秒', check: duration }

export const NODE_FIELDS: NodeField[] = [
  // general
  { key: 'tag', option: 'tag', label: '名称', tab: 'general', kind: 'text', show: always, span: 3, placeholder: '自建 HK', required: true },
  {
    key: 'type',
    option: 'type',
    label: '协议',
    tab: 'general',
    kind: 'select',
    show: always,
    span: 3,
    choices: Object.entries(NODE_PROTOCOLS),
    initial: 'shadowsocks',
  },
  { key: 'server', option: 'server', label: '服务器', tab: 'general', kind: 'text', show: addressed, span: 4, placeholder: 'example.com', mono: true, required: true, check: host },
  { key: 'server_port', option: 'server_port', label: '端口', tab: 'general', kind: 'text', show: addressed, span: 2, placeholder: '443', mono: true, required: true, check: port },
  { key: 'method', option: 'method', label: '加密方式', tab: 'general', kind: 'select', show: is('shadowsocks'), span: 3, choices: SS_METHODS.map((m) => [m, m]), initial: '2022-blake3-aes-128-gcm' },
  { key: 'uuid', option: 'uuid', label: 'UUID', tab: 'general', kind: 'text', show: is('vmess', 'vless', 'tuic'), span: 6, mono: true, required: true },
  {
    key: 'security',
    option: 'security',
    label: '加密方式',
    tab: 'general',
    kind: 'select',
    show: is('vmess'),
    span: 3,
    choices: ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'].map((m) => [m, m]),
    initial: 'auto',
  },
  { key: 'alter_id', option: 'alter_id', label: 'Alter ID', tab: 'general', kind: 'text', show: is('vmess'), span: 3, placeholder: '0', check: uint, more: true },
  { key: 'global_padding', option: 'global_padding', label: '全局填充', tab: 'general', kind: 'switch', show: is('vmess'), more: true },
  { key: 'authenticated_length', option: 'authenticated_length', label: '认证长度', tab: 'general', kind: 'switch', show: is('vmess'), more: true },
  { key: 'flow', option: 'flow', label: '流控', tab: 'general', kind: 'select', show: is('vless'), span: 3, choices: [['', '无'], ['xtls-rprx-vision', 'xtls-rprx-vision']] },
  { key: 'server_ports', option: 'server_ports', label: '端口范围', tab: 'general', kind: 'list', show: (v) => is('hysteria2')(v) && addressed(v), placeholder: '20000:30000', mono: true, check: (value) => /^\d+:\d+$/.test(value) },
  { key: 'hop_interval', option: 'hop_interval', label: '跳跃间隔', tab: 'general', kind: 'text', show: (v) => is('hysteria2')(v) && addressed(v), span: 3, placeholder: '30', ...DURATION_HINT },
  { key: 'hop_interval_max', option: 'hop_interval_max', label: '最大跳跃间隔', tab: 'general', kind: 'text', show: (v) => is('hysteria2')(v) && addressed(v), span: 3, more: true, ...DURATION_HINT },
  { key: 'up_mbps', option: 'up_mbps', label: '上行带宽', tab: 'general', kind: 'text', show: is('hysteria2'), span: 3, unit: 'Mbps', check: uint },
  { key: 'down_mbps', option: 'down_mbps', label: '下行带宽', tab: 'general', kind: 'text', show: is('hysteria2'), span: 3, unit: 'Mbps', check: uint },
  { key: 'obfs_type', option: 'obfs_type', label: '混淆', tab: 'general', kind: 'select', show: is('hysteria2'), span: 3, choices: [['', 'Salamander'], ['gecko', 'Gecko']] },
  { key: 'obfs_password', option: 'obfs_password', label: '混淆密码', tab: 'general', kind: 'password', show: is('hysteria2'), span: 3 },
  { key: 'obfs_min_packet_size', option: 'obfs_min_packet_size', label: '最小包长', tab: 'general', kind: 'text', show: (v) => is('hysteria2')(v) && str(v, 'obfs_type') === 'gecko', span: 3, unit: '字节', placeholder: '512', check: uint },
  { key: 'obfs_max_packet_size', option: 'obfs_max_packet_size', label: '最大包长', tab: 'general', kind: 'text', show: (v) => is('hysteria2')(v) && str(v, 'obfs_type') === 'gecko', span: 3, unit: '字节', placeholder: '1200', check: uint },
  { key: 'snell_version', option: 'version', label: 'Snell 版本', tab: 'general', kind: 'select', show: is('snell'), span: 3, choices: [['4', 'v4 / v5'], ['6', 'v6']], initial: '4', retain: true },
  { key: 'psk', option: 'psk', label: '预共享密钥', tab: 'general', kind: 'password', show: is('snell'), span: 3, required: true },
  { key: 'userkey', option: 'userkey', label: '用户密钥', tab: 'general', kind: 'password', show: is('snell'), span: 3 },
  { key: 'reuse', option: 'reuse', label: '连接复用', tab: 'general', kind: 'switch', show: is('snell'), more: true },
  { key: 'user', option: 'user', label: '用户名', tab: 'general', kind: 'text', show: is('ssh'), span: 3, placeholder: 'root' },
  { key: 'socks_version', option: 'version', label: 'SOCKS 版本', tab: 'general', kind: 'select', show: is('socks'), span: 2, choices: [['', 'SOCKS5'], ['4', 'SOCKS4'], ['4a', 'SOCKS4a']], retain: true },
  { key: 'username', option: 'username', label: '用户名', tab: 'general', kind: 'text', show: is('naive', 'socks', 'http'), span: 3 },
  {
    key: 'password',
    option: 'password',
    label: '密码',
    tab: 'general',
    kind: 'password',
    show: is('shadowsocks', 'trojan', 'hysteria2', 'tuic', 'anytls', 'naive', 'ssh', 'socks', 'http'),
    span: 3,
    required: (v) => PASSWORD_REQUIRED.includes(str(v, 'type')),
  },
  { key: 'plugin', option: 'plugin', label: '插件', tab: 'general', kind: 'select', show: is('shadowsocks'), span: 3, choices: [['', '无'], ['obfs-local', 'obfs-local'], ['v2ray-plugin', 'v2ray-plugin']] },
  { key: 'plugin_opts', option: 'plugin_opts', label: '插件选项', tab: 'general', kind: 'text', show: (v) => is('shadowsocks')(v) && !!str(v, 'plugin'), span: 6, placeholder: 'obfs=http;obfs-host=www.bing.com', mono: true },
  { key: 'congestion_control', option: 'congestion_control', label: '拥塞控制', tab: 'general', kind: 'select', show: is('tuic'), span: 3, choices: [['', 'cubic'], ['new_reno', 'new_reno'], ['bbr', 'bbr']] },
  { key: 'udp_relay_mode', option: 'udp_relay_mode', label: 'UDP 中继模式', tab: 'general', kind: 'select', show: is('tuic'), span: 3, choices: [['', 'native'], ['quic', 'quic']] },
  { key: 'udp_over_stream', option: 'udp_over_stream', label: 'UDP over Stream', tab: 'general', kind: 'switch', show: (v) => is('tuic')(v) && !str(v, 'udp_relay_mode'), more: true },
  { key: 'zero_rtt_handshake', option: 'zero_rtt_handshake', label: '0-RTT 握手', tab: 'general', kind: 'switch', show: is('tuic'), more: true },
  { key: 'heartbeat', option: 'heartbeat', label: '心跳间隔', tab: 'general', kind: 'text', show: is('tuic'), span: 3, placeholder: '10', more: true, ...DURATION_HINT },
  {
    key: 'network',
    option: 'network',
    label: '网络协议',
    tab: 'general',
    kind: 'select',
    show: is('shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'snell', 'socks'),
    span: 3,
    choices: [
      ['', 'TCP 和 UDP'],
      ['tcp', '仅 TCP'],
      ['udp', '仅 UDP'],
    ],
  },
  { key: 'packet_encoding', option: 'packet_encoding', label: 'UDP 包编码', tab: 'general', kind: 'select', show: is('vmess', 'vless'), span: 3, more: true, choices: [['', '默认'], ['packetaddr', 'packetaddr'], ['xudp', 'xudp']] },
  { key: 'bbr_profile', option: 'bbr_profile', label: 'BBR 配置', tab: 'general', kind: 'select', show: is('hysteria2'), span: 3, more: true, choices: [['', 'standard'], ['conservative', 'conservative'], ['aggressive', 'aggressive']] },
  { key: 'brutal_debug', option: 'brutal_debug', label: 'Brutal 调试日志', tab: 'general', kind: 'switch', show: is('hysteria2'), more: true },
  { key: 'disable_chrome_parrot', option: 'disable_chrome_parrot', label: '禁用 Chrome 指纹模仿', tab: 'general', kind: 'switch', show: is('hysteria2'), more: true },
  { key: 'realm_server_url', option: 'realm_server_url', label: 'Realm 服务地址', tab: 'general', kind: 'text', show: is('hysteria2'), span: 6, placeholder: 'https://realm.example.com', mono: true, more: true, check: url, description: '填写后不用服务器和端口，改经 Realm 连接。' },
  { key: 'realm_token', option: 'realm_token', label: 'Realm 令牌', tab: 'general', kind: 'password', show: realm, span: 3, more: true },
  { key: 'realm_realm_id', option: 'realm_realm_id', label: 'Realm ID', tab: 'general', kind: 'text', show: realm, span: 3, more: true, required: true },
  { key: 'realm_stun_servers', option: 'realm_stun_servers', label: 'STUN 服务器', tab: 'general', kind: 'list', show: realm, placeholder: 'stun.l.google.com:19302', mono: true, more: true, required: true },
  { key: 'realm_ip_version', option: 'realm_ip_version', label: 'IP 版本', tab: 'general', kind: 'select', show: realm, span: 3, more: true, choices: [['', 'IPv4 和 IPv6'], ['4', 'IPv4'], ['6', 'IPv6']] },
  { key: 'realm_http_client', option: 'realm_http_client', label: 'HTTP 客户端', tab: 'general', kind: 'select', show: realm, span: 3, more: true, choices: [] },
  { key: 'realm_port_mapping_enabled', option: 'realm_port_mapping_enabled', label: '端口映射', tab: 'general', kind: 'switch', show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6', more: true },
  {
    key: 'realm_port_mapping_timeout',
    option: 'realm_port_mapping_timeout',
    label: '端口映射超时',
    tab: 'general',
    kind: 'text',
    show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6' && on(v, 'realm_port_mapping_enabled'),
    span: 3,
    placeholder: '10',
    more: true,
    ...DURATION_HINT,
  },
  {
    key: 'realm_port_mapping_lifetime',
    option: 'realm_port_mapping_lifetime',
    label: '端口映射租期',
    tab: 'general',
    kind: 'text',
    show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6' && on(v, 'realm_port_mapping_enabled'),
    span: 3,
    placeholder: '10',
    more: true,
    duration: 'm',
    unit: '分钟',
    check: duration,
  },
  { key: 'idle_session_check_interval', option: 'idle_session_check_interval', label: '空闲会话检查间隔', tab: 'general', kind: 'text', show: is('anytls'), span: 3, placeholder: '30', more: true, ...DURATION_HINT },
  { key: 'idle_session_timeout', option: 'idle_session_timeout', label: '空闲会话超时', tab: 'general', kind: 'text', show: is('anytls'), span: 3, placeholder: '30', more: true, ...DURATION_HINT },
  { key: 'min_idle_session', option: 'min_idle_session', label: '最少空闲会话数', tab: 'general', kind: 'text', show: is('anytls'), span: 3, placeholder: '0', more: true, check: uint },
  { key: 'client_metadata', option: 'client_metadata', label: '客户端元数据', tab: 'general', kind: 'text', show: is('anytls'), span: 3, more: true },
  { key: 'insecure_concurrency', option: 'insecure_concurrency', label: '并发连接数', tab: 'general', kind: 'text', show: is('naive'), span: 3, more: true, check: uint },
  { key: 'extra_headers', option: 'extra_headers', label: '请求头', tab: 'general', kind: 'list', show: is('naive'), placeholder: 'User-Agent: Mozilla/5.0', mono: true, more: true, check: header },
  { key: 'naive_stream_receive_window', option: 'stream_receive_window', label: '流接收窗口', tab: 'general', kind: 'text', show: is('naive'), span: 3, placeholder: '6MB', more: true, check: size, retain: true },
  { key: 'udp_over_tcp', option: 'udp_over_tcp', label: 'UDP over TCP', tab: 'general', kind: 'switch', show: is('socks', 'shadowsocks', 'naive'), more: true, description: '用 TCP 承载 UDP。' },
  { key: 'quic', option: 'quic', label: 'QUIC', tab: 'general', kind: 'switch', show: is('naive'), more: true },
  {
    key: 'quic_congestion_control',
    option: 'quic_congestion_control',
    label: '拥塞控制',
    tab: 'general',
    kind: 'select',
    show: (v) => is('naive')(v) && on(v, 'quic'),
    span: 3,
    more: true,
    choices: [['', 'cubic'], ['bbr', 'bbr'], ['bbr2', 'bbr2'], ['reno', 'reno']],
  },
  { key: 'quic_session_receive_window', option: 'quic_session_receive_window', label: '会话接收窗口', tab: 'general', kind: 'text', show: (v) => is('naive')(v) && on(v, 'quic'), span: 3, placeholder: '15MB', more: true, check: size },
  { key: 'obfs_mode', option: 'obfs_mode', label: 'HTTP 混淆', tab: 'general', kind: 'select', show: (v) => is('snell')(v) && str(v, 'snell_version') !== '6', span: 3, choices: [['', '无'], ['http', 'HTTP']] },
  { key: 'obfs_host', option: 'obfs_host', label: '混淆主机名', tab: 'general', kind: 'text', show: (v) => is('snell')(v) && str(v, 'snell_version') !== '6' && str(v, 'obfs_mode') === 'http', span: 3, placeholder: 'bing.com', check: host },
  { key: 'mode', option: 'mode', label: '流量整形', tab: 'general', kind: 'select', show: (v) => is('snell')(v) && str(v, 'snell_version') === '6', span: 3, choices: [['', 'default'], ['unshaped', 'unshaped'], ['unsafe-raw', 'unsafe-raw']] },
  { key: 'private_key', option: 'private_key', label: '私钥', tab: 'general', kind: 'textarea', show: is('ssh'), placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', mono: true },
  { key: 'private_key_path', option: 'private_key_path', label: '私钥文件', tab: 'general', kind: 'text', show: is('ssh'), span: 3, placeholder: '/etc/hako/id_ed25519', mono: true },
  { key: 'private_key_passphrase', option: 'private_key_passphrase', label: '私钥密码', tab: 'general', kind: 'password', show: is('ssh'), span: 3 },
  { key: 'host_key', option: 'host_key', label: '主机密钥', tab: 'general', kind: 'list', show: is('ssh'), placeholder: 'ssh-ed25519 AAAA…', mono: true },
  { key: 'host_key_algorithms', option: 'host_key_algorithms', label: '主机密钥算法', tab: 'general', kind: 'list', show: is('ssh'), placeholder: 'ssh-ed25519', mono: true, more: true },
  { key: 'client_version', option: 'client_version', label: '客户端版本', tab: 'general', kind: 'text', show: is('ssh'), span: 6, placeholder: 'SSH-2.0-OpenSSH_7.4p1', mono: true, more: true },
  { key: 'cipher', option: 'cipher', label: '加密算法', tab: 'general', kind: 'list', show: is('ssh'), placeholder: 'aes128-gcm@openssh.com', mono: true, more: true },
  { key: 'mac', option: 'mac', label: 'MAC 算法', tab: 'general', kind: 'list', show: is('ssh'), placeholder: 'hmac-sha2-256-etm@openssh.com', mono: true, more: true },
  { key: 'kex_algorithm', option: 'kex_algorithm', label: '密钥交换算法', tab: 'general', kind: 'list', show: is('ssh'), placeholder: 'curve25519-sha256', mono: true, more: true },
  { key: 'path', option: 'path', label: '路径', tab: 'general', kind: 'text', show: is('http'), span: 6, placeholder: '/', mono: true },
  { key: 'headers', option: 'headers', label: '请求头', tab: 'general', kind: 'list', show: is('http'), placeholder: 'User-Agent: Mozilla/5.0', mono: true, check: header },

  // tls: the options, and more fields as JSON, which go over them
  { key: 'tls_enabled', option: 'tls_enabled', label: '启用 TLS', tab: 'tls', kind: 'switch', show: (v) => TLS_OPTIONAL.includes(str(v, 'type')) },
  { key: 'tls_server_name', option: 'tls_server_name', label: 'TLS 服务器名称', tab: 'tls', kind: 'text', show: tlsOn, span: 3, mono: true, check: host },
  { key: 'tls_utls_fingerprint', option: 'tls_utls_fingerprint', label: 'uTLS 指纹', tab: 'tls', kind: 'select', show: (v) => tlsOn(v) && UTLS_TYPES.includes(str(v, 'type')), span: 3, choices: [['', '无'], ...UTLS_FINGERPRINTS.map((f): [string, string] => [f, f])] },
  { key: 'tls_insecure', option: 'tls_insecure', label: '跳过证书验证', tab: 'tls', kind: 'switch', show: (v) => tlsOn(v) && str(v, 'type') !== 'naive', description: '不检查服务器证书，只在自签证书时打开。' },
  { key: 'tls_reality_enabled', option: 'tls_reality_enabled', label: '启用 Reality', tab: 'tls', kind: 'switch', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' },
  { key: 'tls_reality_public_key', option: 'tls_reality_public_key', label: 'Reality 公钥', tab: 'tls', kind: 'text', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' && on(v, 'tls_reality_enabled'), span: 4, mono: true, required: true },
  { key: 'tls_reality_short_id', option: 'tls_reality_short_id', label: 'Reality short ID', tab: 'tls', kind: 'text', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' && on(v, 'tls_reality_enabled'), span: 2, mono: true },
  {
    key: 'tls_fields',
    option: 'tls_fields',
    label: 'TLS 字段（JSON）',
    tab: 'tls',
    kind: 'json',
    show: tlsOn,
    more: true,
    placeholder: JSON.stringify({ min_version: '1.2', ech: { enabled: true } }, null, 2),
    description: 'sing-box 的 TLS 字段，会覆盖上面的选项。',
  },

  // transport
  {
    key: 'transport_type',
    option: 'transport_type',
    label: '传输协议',
    tab: 'transport',
    kind: 'select',
    show: is(...TRANSPORT_TYPES),
    span: 3,
    choices: [
      ['', 'TCP'],
      ['ws', 'WebSocket'],
      ['httpupgrade', 'HTTPUpgrade'],
      ['grpc', 'gRPC'],
      ['http', 'HTTP'],
      ['quic', 'QUIC'],
    ],
  },
  { key: 'transport_path', option: 'transport_path', label: '路径', tab: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && ['ws', 'httpupgrade', 'http'].includes(str(v, 'transport_type')), span: 3, placeholder: '/', mono: true },
  { key: 'transport_method', option: 'transport_method', label: 'HTTP 方法', tab: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && str(v, 'transport_type') === 'http', span: 3 },
  { key: 'transport_service_name', option: 'transport_service_name', label: 'gRPC 服务名', tab: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && str(v, 'transport_type') === 'grpc', span: 3, mono: true },
  { key: 'transport_host', option: 'transport_host', label: '主机', tab: 'transport', kind: 'list', show: (v) => is(...TRANSPORT_TYPES)(v) && ['httpupgrade', 'http'].includes(str(v, 'transport_type')), mono: true, check: host },
  { key: 'transport_headers', option: 'transport_headers', label: '请求头', tab: 'transport', kind: 'list', show: (v) => is(...TRANSPORT_TYPES)(v) && ['ws', 'httpupgrade', 'http'].includes(str(v, 'transport_type')), placeholder: 'Host: example.com', mono: true, check: header },

  // multiplex; the maximum streams take the place of the maximum connections
  // and the minimum streams
  { key: 'multiplex_enabled', option: 'multiplex_enabled', label: '启用多路复用', tab: 'multiplex', kind: 'switch', show: is(...MULTIPLEX_TYPES) },
  { key: 'multiplex_protocol', option: 'multiplex_protocol', label: '协议', tab: 'multiplex', kind: 'select', show: multiplexOn, span: 3, choices: [['', 'h2mux'], ['smux', 'smux'], ['yamux', 'yamux']] },
  { key: 'multiplex_max_connections', option: 'multiplex_max_connections', label: '最大连接数', tab: 'multiplex', kind: 'text', show: multiplexOn, span: 3, placeholder: '4', check: uint },
  { key: 'multiplex_min_streams', option: 'multiplex_min_streams', label: '最小流数', tab: 'multiplex', kind: 'text', show: multiplexOn, span: 3, placeholder: '4', check: uint },
  {
    key: 'multiplex_max_streams',
    option: 'multiplex_max_streams',
    label: '最大流数',
    tab: 'multiplex',
    kind: 'text',
    show: (v) => multiplexOn(v) && !str(v, 'multiplex_max_connections') && !str(v, 'multiplex_min_streams'),
    span: 3,
    check: uint,
  },
  { key: 'multiplex_padding', option: 'multiplex_padding', label: '填充', tab: 'multiplex', kind: 'switch', show: multiplexOn },
  { key: 'multiplex_brutal_enabled', option: 'multiplex_brutal_enabled', label: 'TCP Brutal', tab: 'multiplex', kind: 'switch', show: multiplexOn, description: '按设定带宽发送，需要服务器支持。' },
  { key: 'multiplex_brutal_up_mbps', option: 'multiplex_brutal_up_mbps', label: '上行带宽', tab: 'multiplex', kind: 'text', show: (v) => multiplexOn(v) && on(v, 'multiplex_brutal_enabled'), span: 3, unit: 'Mbps', required: true, check: uint },
  { key: 'multiplex_brutal_down_mbps', option: 'multiplex_brutal_down_mbps', label: '下行带宽', tab: 'multiplex', kind: 'text', show: (v) => multiplexOn(v) && on(v, 'multiplex_brutal_enabled'), span: 3, unit: 'Mbps', required: true, check: uint },

  // quic, for hysteria2 and tuic
  { key: 'initial_packet_size', option: 'initial_packet_size', label: '初始包长', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, unit: '字节', check: uint },
  { key: 'max_concurrent_streams', option: 'max_concurrent_streams', label: '最大并发流数', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, check: uint },
  { key: 'idle_timeout', option: 'idle_timeout', label: '闲置超时', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, ...DURATION_HINT },
  { key: 'keep_alive_period', option: 'keep_alive_period', label: '保活周期', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, ...DURATION_HINT },
  { key: 'quic_stream_receive_window', option: 'stream_receive_window', label: '流接收窗口', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, placeholder: '6MB', check: size, retain: true },
  { key: 'connection_receive_window', option: 'connection_receive_window', label: '连接接收窗口', tab: 'quic', kind: 'text', show: is(...QUIC_TYPES), span: 3, placeholder: '15MB', check: size },
  { key: 'disable_path_mtu_discovery', option: 'disable_path_mtu_discovery', label: '禁用路径 MTU 发现', tab: 'quic', kind: 'switch', show: is(...QUIC_TYPES) },

  // dial
  {
    key: 'dial_fields',
    option: 'dial_fields',
    label: '拨号字段（JSON）',
    tab: 'dial',
    kind: 'json',
    show: always,
    placeholder: JSON.stringify({ bind_interface: 'pppoe-wan', connect_timeout: '5s', tcp_fast_open: true }, null, 2),
    description: 'sing-box 的拨号字段，原样写入。可用 detour 经另一个节点或策略组连接。',
  },
]

// a protocol that always uses TLS shows it on
export function tlsRequired(type: string) {
  return TLS_REQUIRED.includes(type)
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// the values of the form from a section, or for a new node
export function nodeValues(section: UciSection | null): NodeValues {
  const values: NodeValues = {}
  for (const field of NODE_FIELDS) {
    const value = section?.[field.option]
    if (field.kind === 'list') values[field.key] = list(value)
    else if (section) {
      const text = typeof value === 'string' ? value : Array.isArray(value) ? value.join(' ') : ''
      values[field.key] = field.duration ? durationField(text, field.duration) : text
    } else values[field.key] = field.initial ?? ''
  }
  return values
}

// the TLS options by their fields in the JSON, which goes over them: when the
// JSON has fields, the options are written into it too, so it never says
// otherwise
const TLS_BINDINGS: [string, (tls: Record<string, any>, value: string) => void][] = [
  ['tls_server_name', (tls, value) => (tls.server_name = value || undefined)],
  ['tls_insecure', (tls, value) => (tls.insecure = value === '1' || undefined)],
  ['tls_utls_fingerprint', (tls, value) => (tls.utls = value ? { ...tls.utls, enabled: true, fingerprint: value } : undefined)],
  ['tls_reality_enabled', (tls, value) => (tls.reality = value === '1' ? { ...tls.reality, enabled: true } : undefined)],
  ['tls_reality_public_key', (tls, value) => tls.reality && (tls.reality.public_key = value || undefined)],
  ['tls_reality_short_id', (tls, value) => tls.reality && (tls.reality.short_id = value || undefined)],
]

// the UCI options to save from the form: those of the fields shown, and the
// others of the dialog removed, but for those kept for a field sharing them
export function nodeOptions(values: NodeValues): Record<string, string | string[]> {
  const shown = NODE_FIELDS.filter((field) => field.show(values))
  const options: Record<string, string | string[]> = {}

  for (const field of shown) {
    const value = values[field.key]
    if (Array.isArray(value)) options[field.option] = value.map((item) => item.trim()).filter(Boolean)
    else {
      const text = value.trim()
      options[field.option] = field.duration && /^\d+$/.test(text) ? `${text}${field.duration}` : field.kind === 'json' ? jsonText(text) : text
    }
  }

  // TLS options into the JSON of TLS fields
  if (typeof options.tls_fields === 'string' && options.tls_fields) {
    const tls = { enabled: true, ...parseObject(options.tls_fields) }
    for (const [option, write] of TLS_BINDINGS) if (option in options) write(tls, String(options[option]))
    options.tls_fields = jsonText(JSON.stringify(tls))
  }

  for (const field of NODE_FIELDS) if (!(field.option in options) && !field.retain) options[field.option] = ''
  return options
}

function jsonText(value: string) {
  const parsed = value ? parseObject(value) : null
  if (!parsed || !Object.keys(parsed).length) return ''
  return JSON.stringify(parsed, null, 2)
}

// the checks of the fields shown: required ones set, values and list items
// of the right form, JSON an object. Names are checked against the other
// outbounds
export function nodeSchema(values: NodeValues, taken: string[]) {
  const shape: Record<string, z.ZodType> = {}
  for (const field of NODE_FIELDS.filter((field) => field.show(values))) {
    const required = typeof field.required === 'function' ? field.required(values) : !!field.required
    const check = field.check
    if (field.kind === 'list')
      shape[field.key] = z
        .array(z.string())
        .refine((items) => !required || items.some((item) => item.trim()))
        .refine((items) => !check || items.every((item) => !item.trim() || check(item.trim())))
    else if (field.kind === 'json')
      shape[field.key] = z
        .string()
        .refine((value) => !value.trim() || parseObject(value) != null)
        // TLS is turned off by Enable TLS, not in the JSON
        .refine((value) => field.key !== 'tls_fields' || parseObject(value)?.enabled !== false)
    else
      shape[field.key] = z
        .string()
        .trim()
        .refine((value) => !required || value !== '')
        .refine((value) => !check || value === '' || check(value))
  }
  shape.tag = (shape.tag as z.ZodString).refine((value) => value !== 'GLOBAL' && !taken.includes(value.trim()))
  return z.object(shape)
}
