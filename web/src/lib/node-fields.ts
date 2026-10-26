import { z } from 'zod'

import { DURATION, durationField, list } from '@/lib/outbounds'
import type { UciSection } from '@/lib/uci'

// the fields of the dialog of a node, as the LuCI one has them, in the order
// of the sing-box docs: each by its UCI option, the section it is in, and
// when it shows. Sections sit on tabs, in a left or a right column. A switch
// is '1' or '', a list an array, the rest strings

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
  obfs: '混淆',
  hop: '端口跳跃',
  realm: 'Realm',
  tls: 'TLS',
  transport: '传输',
  multiplex: '多路复用',
  quic: 'QUIC',
  key: '私钥',
  advanced: '高级',
  dial: '拨号',
} as const

export type Tab = keyof typeof TABS

// the tabs of each protocol
const PROTOCOL_TABS: Record<string, Tab[]> = {
  shadowsocks: ['general', 'multiplex', 'dial'],
  vmess: ['general', 'tls', 'transport', 'multiplex', 'dial'],
  vless: ['general', 'tls', 'transport', 'multiplex', 'dial'],
  trojan: ['general', 'tls', 'transport', 'multiplex', 'dial'],
  hysteria2: ['general', 'obfs', 'hop', 'realm', 'tls', 'quic', 'dial'],
  tuic: ['general', 'tls', 'quic', 'dial'],
  anytls: ['general', 'tls', 'dial'],
  naive: ['general', 'tls', 'quic', 'dial'],
  snell: ['general', 'obfs', 'dial'],
  ssh: ['general', 'key', 'advanced', 'dial'],
  socks: ['general', 'dial'],
  http: ['general', 'tls', 'dial'],
}

export function nodeTabs(type: string): Tab[] {
  return PROTOCOL_TABS[type] ?? ['general', 'dial']
}

// the sections, by tab and column, in their order; the one of the protocol
// is titled by it
export const SECTIONS: { id: string; title: string; tab: Tab; column: 'left' | 'right' }[] = [
  { id: 'basic', title: '基本信息', tab: 'general', column: 'left' },
  { id: 'server', title: '服务器信息', tab: 'general', column: 'left' },
  { id: 'options', title: '选项', tab: 'general', column: 'left' },
  { id: 'protocol', title: '', tab: 'general', column: 'right' },
  { id: 'idle', title: '空闲会话', tab: 'general', column: 'right' },
  { id: 'headers', title: '请求头', tab: 'general', column: 'right' },
  { id: 'obfs', title: '混淆', tab: 'obfs', column: 'left' },
  { id: 'gecko', title: 'Gecko', tab: 'obfs', column: 'right' },
  { id: 'snell_obfs', title: 'HTTP 混淆', tab: 'obfs', column: 'left' },
  { id: 'snell_shaping', title: '流量整形', tab: 'obfs', column: 'right' },
  { id: 'hop_ranges', title: '端口范围', tab: 'hop', column: 'left' },
  { id: 'hop_interval', title: '跳跃间隔', tab: 'hop', column: 'right' },
  { id: 'realm', title: 'Realm', tab: 'realm', column: 'left' },
  { id: 'realm_network', title: '网络', tab: 'realm', column: 'right' },
  { id: 'realm_mapping', title: '端口映射', tab: 'realm', column: 'right' },
  { id: 'tls', title: 'TLS', tab: 'tls', column: 'left' },
  { id: 'reality', title: 'Reality', tab: 'tls', column: 'right' },
  { id: 'tls_json', title: '高级', tab: 'tls', column: 'right' },
  { id: 'transport', title: '传输', tab: 'transport', column: 'left' },
  { id: 'transport_headers', title: '请求头', tab: 'transport', column: 'right' },
  { id: 'multiplex', title: '多路复用', tab: 'multiplex', column: 'left' },
  { id: 'brutal', title: 'TCP Brutal', tab: 'multiplex', column: 'right' },
  { id: 'quic', title: 'QUIC', tab: 'quic', column: 'left' },
  { id: 'quic_window', title: '接收窗口', tab: 'quic', column: 'right' },
  { id: 'ssh_key', title: '私钥', tab: 'key', column: 'left' },
  { id: 'ssh_key_file', title: '私钥文件', tab: 'key', column: 'right' },
  { id: 'ssh_host', title: '主机验证', tab: 'advanced', column: 'left' },
  { id: 'ssh_algorithms', title: '算法', tab: 'advanced', column: 'right' },
  { id: 'dial_chain', title: '代理链', tab: 'dial', column: 'left' },
  { id: 'dial_outbound', title: '出站设置', tab: 'dial', column: 'left' },
  { id: 'dial_options', title: '选项', tab: 'dial', column: 'right' },
  { id: 'dial_json', title: '高级', tab: 'dial', column: 'right' },
]

type Kind = 'text' | 'password' | 'select' | 'segmented' | 'switch' | 'list' | 'textarea' | 'json' | 'server' | 'streams'

export type NodeField = {
  // the key in the form, which is the UCI option unless two fields share
  // one; none for one kept in another option
  key: string
  option: string
  label: string
  section: string
  kind: Kind
  show: (v: NodeValues) => boolean
  // the width of the control: 40%, 32% or 66% of the row, else 56%
  width?: 'short' | 'tiny' | 'wide'
  choices?: [string, string][]
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

const SECONDS = { duration: 's' as const, unit: '秒', check: duration, width: 'short' as const }
const NETWORK_CHOICES: [string, string][] = [
  ['', 'TCP 和 UDP'],
  ['tcp', '仅 TCP'],
  ['udp', '仅 UDP'],
]

export const NODE_FIELDS: NodeField[] = [
  // general: the node and its server
  { key: 'tag', option: 'tag', label: '名称', section: 'basic', kind: 'text', show: always, required: true },
  { key: 'type', option: 'type', label: '协议', section: 'basic', kind: 'select', show: always, choices: Object.entries(NODE_PROTOCOLS), initial: 'shadowsocks' },
  // the port shows in the row of the server
  { key: 'server', option: 'server', label: '服务器地址', section: 'server', kind: 'server', show: addressed, mono: true, required: true, check: host },
  { key: 'server_port', option: 'server_port', label: '端口', section: 'server', kind: 'text', show: addressed, required: true, check: port },

  // general: the options of the connection
  { key: 'network', option: 'network', label: '网络协议', section: 'options', kind: 'segmented', show: is('shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'snell', 'socks'), choices: NETWORK_CHOICES },
  { key: 'udp_over_tcp', option: 'udp_over_tcp', label: 'UDP over TCP', section: 'options', kind: 'switch', show: is('socks', 'shadowsocks', 'naive'), description: '用 TCP 承载 UDP。' },
  { key: 'packet_encoding', option: 'packet_encoding', label: 'UDP 包编码', section: 'options', kind: 'select', show: is('vmess', 'vless'), width: 'short', choices: [['', '默认'], ['packetaddr', 'packetaddr'], ['xudp', 'xudp']] },
  { key: 'disable_chrome_parrot', option: 'disable_chrome_parrot', label: '禁用 Chrome 指纹模仿', section: 'options', kind: 'switch', show: is('hysteria2') },
  { key: 'zero_rtt_handshake', option: 'zero_rtt_handshake', label: '0-RTT 握手', section: 'options', kind: 'switch', show: is('tuic') },
  { key: 'reuse', option: 'reuse', label: '连接复用', section: 'options', kind: 'switch', show: is('snell'), description: '后续请求复用已有的连接。' },

  // general: what the protocol takes
  { key: 'snell_version', option: 'version', label: '版本', section: 'protocol', kind: 'segmented', show: is('snell'), choices: [['4', 'v4 / v5'], ['6', 'v6']], initial: '4', retain: true },
  { key: 'socks_version', option: 'version', label: '版本', section: 'protocol', kind: 'segmented', show: is('socks'), choices: [['', 'SOCKS5'], ['4', 'SOCKS4'], ['4a', 'SOCKS4a']], retain: true },
  { key: 'uuid', option: 'uuid', label: 'UUID', section: 'protocol', kind: 'text', show: is('vmess', 'vless', 'tuic'), width: 'wide', mono: true, required: true },
  { key: 'user', option: 'user', label: '用户名', section: 'protocol', kind: 'text', show: is('ssh') },
  { key: 'username', option: 'username', label: '用户名', section: 'protocol', kind: 'text', show: is('naive', 'socks', 'http') },
  { key: 'method', option: 'method', label: '加密方式', section: 'protocol', kind: 'select', show: is('shadowsocks'), choices: SS_METHODS.map((m) => [m, m]), initial: '2022-blake3-aes-128-gcm' },
  { key: 'security', option: 'security', label: '加密方式', section: 'protocol', kind: 'select', show: is('vmess'), width: 'short', choices: ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'].map((m) => [m, m]), initial: 'auto' },
  { key: 'alter_id', option: 'alter_id', label: 'Alter ID', section: 'protocol', kind: 'text', show: is('vmess'), width: 'tiny', check: uint, initial: '0' },
  { key: 'global_padding', option: 'global_padding', label: '全局填充', section: 'protocol', kind: 'switch', show: is('vmess') },
  { key: 'authenticated_length', option: 'authenticated_length', label: '认证长度', section: 'protocol', kind: 'switch', show: is('vmess') },
  { key: 'flow', option: 'flow', label: '流控', section: 'protocol', kind: 'select', show: is('vless'), choices: [['', '无'], ['xtls-rprx-vision', 'xtls-rprx-vision']] },
  {
    key: 'password',
    option: 'password',
    label: '密码',
    section: 'protocol',
    kind: 'password',
    show: is('shadowsocks', 'trojan', 'hysteria2', 'tuic', 'anytls', 'naive', 'ssh', 'socks', 'http'),
    required: (v) => PASSWORD_REQUIRED.includes(str(v, 'type')),
  },
  { key: 'psk', option: 'psk', label: '预共享密钥', section: 'protocol', kind: 'password', show: is('snell'), required: true },
  { key: 'userkey', option: 'userkey', label: '用户密钥', section: 'protocol', kind: 'password', show: is('snell') },
  { key: 'plugin', option: 'plugin', label: '插件', section: 'protocol', kind: 'select', show: is('shadowsocks'), width: 'short', choices: [['', '无'], ['obfs-local', 'obfs-local'], ['v2ray-plugin', 'v2ray-plugin']] },
  { key: 'plugin_opts', option: 'plugin_opts', label: '插件选项', section: 'protocol', kind: 'text', show: (v) => is('shadowsocks')(v) && !!str(v, 'plugin'), mono: true },
  { key: 'client_metadata', option: 'client_metadata', label: '客户端元数据', section: 'protocol', kind: 'text', show: is('anytls') },
  { key: 'up_mbps', option: 'up_mbps', label: '上行带宽', section: 'protocol', kind: 'text', show: is('hysteria2'), width: 'short', unit: 'Mbps', check: uint },
  { key: 'down_mbps', option: 'down_mbps', label: '下行带宽', section: 'protocol', kind: 'text', show: is('hysteria2'), width: 'short', unit: 'Mbps', check: uint },
  { key: 'bbr_profile', option: 'bbr_profile', label: 'BBR 配置', section: 'protocol', kind: 'select', show: is('hysteria2'), width: 'short', choices: [['', 'standard'], ['conservative', 'conservative'], ['aggressive', 'aggressive']] },
  { key: 'brutal_debug', option: 'brutal_debug', label: 'Brutal 调试日志', section: 'protocol', kind: 'switch', show: is('hysteria2') },
  { key: 'congestion_control', option: 'congestion_control', label: '拥塞控制', section: 'protocol', kind: 'segmented', show: is('tuic'), choices: [['', 'cubic'], ['new_reno', 'new_reno'], ['bbr', 'bbr']] },
  { key: 'udp_relay_mode', option: 'udp_relay_mode', label: 'UDP 中继模式', section: 'protocol', kind: 'segmented', show: is('tuic'), choices: [['', 'native'], ['quic', 'quic']] },
  { key: 'udp_over_stream', option: 'udp_over_stream', label: 'UDP over Stream', section: 'protocol', kind: 'switch', show: (v) => is('tuic')(v) && !str(v, 'udp_relay_mode'), description: '只用于 native 中继模式。' },
  { key: 'heartbeat', option: 'heartbeat', label: '心跳间隔', section: 'protocol', kind: 'text', show: is('tuic'), ...SECONDS },
  { key: 'insecure_concurrency', option: 'insecure_concurrency', label: '并发连接数', section: 'protocol', kind: 'text', show: is('naive'), width: 'tiny', check: uint },
  { key: 'naive_stream_receive_window', option: 'stream_receive_window', label: '流接收窗口', section: 'protocol', kind: 'text', show: is('naive'), width: 'short', check: size, retain: true },
  { key: 'path', option: 'path', label: '路径', section: 'protocol', kind: 'text', show: is('http'), mono: true },

  // general: more of anytls, naive and http
  { key: 'idle_session_check_interval', option: 'idle_session_check_interval', label: '检查间隔', section: 'idle', kind: 'text', show: is('anytls'), ...SECONDS },
  { key: 'idle_session_timeout', option: 'idle_session_timeout', label: '超时', section: 'idle', kind: 'text', show: is('anytls'), ...SECONDS },
  { key: 'min_idle_session', option: 'min_idle_session', label: '最少空闲会话数', section: 'idle', kind: 'text', show: is('anytls'), width: 'tiny', check: uint },
  { key: 'extra_headers', option: 'extra_headers', label: '请求头', section: 'headers', kind: 'list', show: is('naive'), mono: true, check: header },
  { key: 'headers', option: 'headers', label: '请求头', section: 'headers', kind: 'list', show: is('http'), mono: true, check: header },

  // obfuscation of hysteria2 and snell
  { key: 'obfs_type', option: 'obfs_type', label: '混淆类型', section: 'obfs', kind: 'segmented', show: is('hysteria2'), choices: [['', 'Salamander'], ['gecko', 'Gecko']] },
  { key: 'obfs_password', option: 'obfs_password', label: '混淆密码', section: 'obfs', kind: 'password', show: is('hysteria2'), description: '留空则不混淆。' },
  { key: 'obfs_min_packet_size', option: 'obfs_min_packet_size', label: '最小包长', section: 'gecko', kind: 'text', show: (v) => is('hysteria2')(v) && str(v, 'obfs_type') === 'gecko', width: 'short', unit: '字节', check: uint },
  { key: 'obfs_max_packet_size', option: 'obfs_max_packet_size', label: '最大包长', section: 'gecko', kind: 'text', show: (v) => is('hysteria2')(v) && str(v, 'obfs_type') === 'gecko', width: 'short', unit: '字节', check: uint },
  { key: 'obfs_mode', option: 'obfs_mode', label: 'HTTP 混淆', section: 'snell_obfs', kind: 'segmented', show: (v) => is('snell')(v) && str(v, 'snell_version') !== '6', choices: [['', '无'], ['http', 'HTTP']] },
  { key: 'obfs_host', option: 'obfs_host', label: '混淆主机名', section: 'snell_obfs', kind: 'text', show: (v) => is('snell')(v) && str(v, 'snell_version') !== '6' && str(v, 'obfs_mode') === 'http', mono: true, check: host },
  { key: 'mode', option: 'mode', label: '流量整形', section: 'snell_shaping', kind: 'select', show: (v) => is('snell')(v) && str(v, 'snell_version') === '6', width: 'short', choices: [['', 'default'], ['unshaped', 'unshaped'], ['unsafe-raw', 'unsafe-raw']] },

  // port hopping of hysteria2
  { key: 'server_ports', option: 'server_ports', label: '端口范围', section: 'hop_ranges', kind: 'list', show: (v) => is('hysteria2')(v) && addressed(v), mono: true, check: (value) => /^\d+:\d+$/.test(value), description: '在这些端口间跳跃，如 20000:30000；不填则只用基本页的端口。' },
  { key: 'hop_interval', option: 'hop_interval', label: '跳跃间隔', section: 'hop_interval', kind: 'text', show: (v) => is('hysteria2')(v) && addressed(v), ...SECONDS },
  { key: 'hop_interval_max', option: 'hop_interval_max', label: '最大跳跃间隔', section: 'hop_interval', kind: 'text', show: (v) => is('hysteria2')(v) && addressed(v), ...SECONDS, description: '填写后在两者之间随机。' },

  // the realm of hysteria2
  { key: 'realm_server_url', option: 'realm_server_url', label: 'Realm 服务地址', section: 'realm', kind: 'text', show: is('hysteria2'), mono: true, check: url, description: '填写后不用服务器地址和端口，改经 Realm 连接。' },
  { key: 'realm_token', option: 'realm_token', label: 'Realm 令牌', section: 'realm', kind: 'password', show: realm },
  { key: 'realm_realm_id', option: 'realm_realm_id', label: 'Realm ID', section: 'realm', kind: 'text', show: realm, required: true },
  { key: 'realm_stun_servers', option: 'realm_stun_servers', label: 'STUN 服务器', section: 'realm', kind: 'list', show: realm, mono: true, required: true },
  { key: 'realm_ip_version', option: 'realm_ip_version', label: 'IP 版本', section: 'realm_network', kind: 'segmented', show: realm, choices: [['', 'IPv4 和 IPv6'], ['4', 'IPv4'], ['6', 'IPv6']] },
  { key: 'realm_http_client', option: 'realm_http_client', label: 'HTTP 客户端', section: 'realm_network', kind: 'select', show: realm, choices: [] },
  { key: 'realm_port_mapping_enabled', option: 'realm_port_mapping_enabled', label: '端口映射', section: 'realm_mapping', kind: 'switch', show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6' },
  {
    key: 'realm_port_mapping_timeout',
    option: 'realm_port_mapping_timeout',
    label: '端口映射超时',
    section: 'realm_mapping',
    kind: 'text',
    show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6' && on(v, 'realm_port_mapping_enabled'),
    ...SECONDS,
  },
  {
    key: 'realm_port_mapping_lifetime',
    option: 'realm_port_mapping_lifetime',
    label: '端口映射租期',
    section: 'realm_mapping',
    kind: 'text',
    show: (v) => realm(v) && str(v, 'realm_ip_version') !== '6' && on(v, 'realm_port_mapping_enabled'),
    width: 'short',
    duration: 'm',
    unit: '分钟',
    check: duration,
  },

  // tls: the options, and more fields as JSON, which go over them
  { key: 'tls_enabled', option: 'tls_enabled', label: '启用 TLS', section: 'tls', kind: 'switch', show: (v) => TLS_OPTIONAL.includes(str(v, 'type')) },
  { key: 'tls_server_name', option: 'tls_server_name', label: 'TLS 服务器名称', section: 'tls', kind: 'text', show: tlsOn, mono: true, check: host },
  { key: 'tls_utls_fingerprint', option: 'tls_utls_fingerprint', label: 'uTLS 指纹', section: 'tls', kind: 'select', show: (v) => tlsOn(v) && UTLS_TYPES.includes(str(v, 'type')), width: 'short', choices: [['', '无'], ...UTLS_FINGERPRINTS.map((f): [string, string] => [f, f])] },
  { key: 'tls_insecure', option: 'tls_insecure', label: '跳过证书验证', section: 'tls', kind: 'switch', show: (v) => tlsOn(v) && str(v, 'type') !== 'naive', description: '不检查服务器证书，只在自签证书时打开。' },
  { key: 'tls_reality_enabled', option: 'tls_reality_enabled', label: '启用 Reality', section: 'reality', kind: 'switch', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' },
  { key: 'tls_reality_public_key', option: 'tls_reality_public_key', label: 'Reality 公钥', section: 'reality', kind: 'text', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' && on(v, 'tls_reality_enabled'), mono: true, required: true },
  { key: 'tls_reality_short_id', option: 'tls_reality_short_id', label: 'Reality short ID', section: 'reality', kind: 'text', show: (v) => tlsOn(v) && str(v, 'type') === 'vless' && on(v, 'tls_reality_enabled'), width: 'short', mono: true },
  { key: 'tls_fields', option: 'tls_fields', label: 'TLS 字段（JSON）', section: 'tls_json', kind: 'json', show: tlsOn, description: 'sing-box 的 TLS 字段，会覆盖左边的选项。' },

  // transport
  {
    key: 'transport_type',
    option: 'transport_type',
    label: '传输协议',
    section: 'transport',
    kind: 'select',
    show: is(...TRANSPORT_TYPES),
    width: 'short',
    choices: [
      ['', 'TCP'],
      ['ws', 'WebSocket'],
      ['httpupgrade', 'HTTPUpgrade'],
      ['grpc', 'gRPC'],
      ['http', 'HTTP'],
      ['quic', 'QUIC'],
    ],
  },
  { key: 'transport_path', option: 'transport_path', label: '路径', section: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && ['ws', 'httpupgrade', 'http'].includes(str(v, 'transport_type')), mono: true },
  { key: 'transport_host', option: 'transport_host', label: '主机', section: 'transport', kind: 'list', show: (v) => is(...TRANSPORT_TYPES)(v) && ['httpupgrade', 'http'].includes(str(v, 'transport_type')), mono: true, check: host },
  { key: 'transport_method', option: 'transport_method', label: 'HTTP 方法', section: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && str(v, 'transport_type') === 'http', width: 'short' },
  { key: 'transport_service_name', option: 'transport_service_name', label: 'gRPC 服务名', section: 'transport', kind: 'text', show: (v) => is(...TRANSPORT_TYPES)(v) && str(v, 'transport_type') === 'grpc', mono: true },
  { key: 'transport_headers', option: 'transport_headers', label: '请求头', section: 'transport_headers', kind: 'list', show: (v) => is(...TRANSPORT_TYPES)(v) && ['ws', 'httpupgrade', 'http'].includes(str(v, 'transport_type')), mono: true, check: header },

  // multiplex; the streams are the minimum, with the maximum connections, or
  // the maximum, which takes their place
  { key: 'multiplex_enabled', option: 'multiplex_enabled', label: '启用多路复用', section: 'multiplex', kind: 'switch', show: is(...MULTIPLEX_TYPES) },
  { key: 'multiplex_protocol', option: 'multiplex_protocol', label: '协议', section: 'multiplex', kind: 'segmented', show: multiplexOn, choices: [['', 'h2mux'], ['smux', 'smux'], ['yamux', 'yamux']] },
  { key: 'multiplex_streams', option: '', label: '流数', section: 'multiplex', kind: 'streams', show: multiplexOn, check: uint, description: '先选按最小还是最大流数，再填数量。' },
  { key: 'multiplex_max_connections', option: 'multiplex_max_connections', label: '最大连接数', section: 'multiplex', kind: 'text', show: (v) => multiplexOn(v) && str(v, 'multiplex_streams_kind') !== 'max', width: 'tiny', check: uint },
  { key: 'multiplex_padding', option: 'multiplex_padding', label: '填充', section: 'multiplex', kind: 'switch', show: multiplexOn },
  { key: 'multiplex_brutal_enabled', option: 'multiplex_brutal_enabled', label: 'TCP Brutal', section: 'brutal', kind: 'switch', show: multiplexOn, description: '按设定带宽发送，需要服务器支持。' },
  { key: 'multiplex_brutal_up_mbps', option: 'multiplex_brutal_up_mbps', label: '上行带宽', section: 'brutal', kind: 'text', show: (v) => multiplexOn(v) && on(v, 'multiplex_brutal_enabled'), width: 'short', unit: 'Mbps', required: true, check: uint },
  { key: 'multiplex_brutal_down_mbps', option: 'multiplex_brutal_down_mbps', label: '下行带宽', section: 'brutal', kind: 'text', show: (v) => multiplexOn(v) && on(v, 'multiplex_brutal_enabled'), width: 'short', unit: 'Mbps', required: true, check: uint },

  // quic, of hysteria2 and tuic, and of naive over HTTP/3
  { key: 'initial_packet_size', option: 'initial_packet_size', label: '初始包长', section: 'quic', kind: 'text', show: is(...QUIC_TYPES), width: 'short', unit: '字节', check: uint },
  { key: 'max_concurrent_streams', option: 'max_concurrent_streams', label: '最大并发流数', section: 'quic', kind: 'text', show: is(...QUIC_TYPES), width: 'short', check: uint },
  { key: 'idle_timeout', option: 'idle_timeout', label: '闲置超时', section: 'quic', kind: 'text', show: is(...QUIC_TYPES), ...SECONDS },
  { key: 'keep_alive_period', option: 'keep_alive_period', label: '保活周期', section: 'quic', kind: 'text', show: is(...QUIC_TYPES), ...SECONDS },
  { key: 'disable_path_mtu_discovery', option: 'disable_path_mtu_discovery', label: '禁用路径 MTU 发现', section: 'quic', kind: 'switch', show: is(...QUIC_TYPES) },
  { key: 'quic', option: 'quic', label: 'QUIC', section: 'quic', kind: 'switch', show: is('naive'), description: '改用 HTTP/3 连接。' },
  { key: 'quic_congestion_control', option: 'quic_congestion_control', label: '拥塞控制', section: 'quic', kind: 'segmented', show: (v) => is('naive')(v) && on(v, 'quic'), choices: [['', 'cubic'], ['bbr', 'bbr'], ['bbr2', 'bbr2'], ['reno', 'reno']] },
  { key: 'quic_stream_receive_window', option: 'stream_receive_window', label: '流接收窗口', section: 'quic_window', kind: 'text', show: is(...QUIC_TYPES), width: 'short', check: size, retain: true },
  { key: 'connection_receive_window', option: 'connection_receive_window', label: '连接接收窗口', section: 'quic_window', kind: 'text', show: is(...QUIC_TYPES), width: 'short', check: size },
  { key: 'quic_session_receive_window', option: 'quic_session_receive_window', label: '会话接收窗口', section: 'quic_window', kind: 'text', show: (v) => is('naive')(v) && on(v, 'quic'), width: 'short', check: size },

  // ssh keys and algorithms
  { key: 'private_key', option: 'private_key', label: '私钥', section: 'ssh_key', kind: 'textarea', show: is('ssh'), mono: true },
  { key: 'private_key_path', option: 'private_key_path', label: '私钥文件', section: 'ssh_key_file', kind: 'text', show: is('ssh'), mono: true },
  { key: 'private_key_passphrase', option: 'private_key_passphrase', label: '私钥密码', section: 'ssh_key_file', kind: 'password', show: is('ssh') },
  { key: 'host_key', option: 'host_key', label: '主机密钥', section: 'ssh_host', kind: 'list', show: is('ssh'), mono: true },
  { key: 'host_key_algorithms', option: 'host_key_algorithms', label: '主机密钥算法', section: 'ssh_host', kind: 'list', show: is('ssh'), mono: true },
  { key: 'client_version', option: 'client_version', label: '客户端版本', section: 'ssh_algorithms', kind: 'text', show: is('ssh'), mono: true },
  { key: 'cipher', option: 'cipher', label: '加密算法', section: 'ssh_algorithms', kind: 'list', show: is('ssh'), mono: true },
  { key: 'mac', option: 'mac', label: 'MAC 算法', section: 'ssh_algorithms', kind: 'list', show: is('ssh'), mono: true },
  { key: 'kex_algorithm', option: 'kex_algorithm', label: '密钥交换算法', section: 'ssh_algorithms', kind: 'list', show: is('ssh'), mono: true },

  // dial: the fields of dial_fields used most as options of their own, the
  // rest as JSON
  { key: 'dial_detour', option: '', label: '跳板代理', section: 'dial_chain', kind: 'select', show: always, choices: [], description: '经另一个节点或策略组连接这个节点。' },
  { key: 'dial_bind_interface', option: '', label: '网络接口', section: 'dial_outbound', kind: 'select', show: always, choices: [], description: '从指定的网络接口连出，如 pppoe-wan 或另一条 WAN。' },
  { key: 'dial_connect_timeout', option: '', label: '连接超时', section: 'dial_outbound', kind: 'text', show: always, ...SECONDS },
  { key: 'dial_tcp_fast_open', option: '', label: 'TCP Fast Open', section: 'dial_options', kind: 'switch', show: always },
  { key: 'dial_tcp_multi_path', option: '', label: 'MPTCP', section: 'dial_options', kind: 'switch', show: always, description: '多路径 TCP，服务器也要支持。' },
  { key: 'dial_fields', option: 'dial_fields', label: '其他拨号字段（JSON）', section: 'dial_json', kind: 'json', show: always, description: '上面没有的 sing-box 拨号字段，原样写入。' },
]

// a protocol that always uses TLS shows it on
export function tlsRequired(type: string) {
  return TLS_REQUIRED.includes(type)
}

export function fieldTab(field: NodeField) {
  return SECTIONS.find((section) => section.id === field.section)?.tab ?? 'general'
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function jsonText(value: string | Record<string, unknown>) {
  const parsed = typeof value === 'string' ? (value ? parseObject(value) : null) : value
  if (!parsed || !Object.keys(parsed).length) return ''
  return JSON.stringify(parsed, null, 2)
}

// the dial fields that have options of their own, by the key in the form:
// [ field in dial_fields, as the form shows it, as dial_fields takes it ]
const DIAL_BINDINGS: [string, string, (value: unknown) => string, (value: string) => unknown][] = [
  ['dial_detour', 'detour', (value) => (typeof value === 'string' ? value : ''), (value) => value || undefined],
  ['dial_bind_interface', 'bind_interface', (value) => (typeof value === 'string' ? value : ''), (value) => value || undefined],
  ['dial_connect_timeout', 'connect_timeout', (value) => (typeof value === 'string' ? durationField(value, 's') : ''), (value) => (value ? (/^\d+$/.test(value) ? `${value}s` : value) : undefined)],
  ['dial_tcp_fast_open', 'tcp_fast_open', (value) => (value === true ? '1' : ''), (value) => (value === '1' ? true : undefined)],
  ['dial_tcp_multi_path', 'tcp_multi_path', (value) => (value === true ? '1' : ''), (value) => (value === '1' ? true : undefined)],
]

// the values of the form from a section, or for a new node
export function nodeValues(section: UciSection | null): NodeValues {
  const values: NodeValues = {}
  for (const field of NODE_FIELDS) {
    if (!field.option) values[field.key] = ''
    else if (field.kind === 'list') values[field.key] = list(section?.[field.option])
    else if (section) {
      const value = section[field.option]
      const text = typeof value === 'string' ? value : Array.isArray(value) ? value.join(' ') : ''
      values[field.key] = field.duration ? durationField(text, field.duration) : text
    } else values[field.key] = field.initial ?? ''
  }

  // the streams by the one of them set
  const max = typeof section?.multiplex_max_streams === 'string' ? section.multiplex_max_streams : ''
  values.multiplex_streams_kind = max ? 'max' : 'min'
  values.multiplex_streams = max || (typeof section?.multiplex_min_streams === 'string' ? section.multiplex_min_streams : '')

  // the dial fields with options of their own out of the JSON
  const dial = parseObject(typeof section?.dial_fields === 'string' ? section.dial_fields : '') ?? {}
  for (const [key, field, read] of DIAL_BINDINGS) {
    values[key] = read(dial[field])
    delete dial[field]
  }
  values.dial_fields = jsonText(dial)
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
  const shown = NODE_FIELDS.filter((field) => field.option && field.show(values))
  const options: Record<string, string | string[]> = {}

  for (const field of shown) {
    const value = values[field.key]
    if (Array.isArray(value)) options[field.option] = value.map((item) => item.trim()).filter(Boolean)
    else {
      const text = value.trim()
      options[field.option] = field.duration && /^\d+$/.test(text) ? `${text}${field.duration}` : field.kind === 'json' ? jsonText(text) : text
    }
  }

  // the streams, the minimum or the maximum
  const streams = String(values.multiplex_streams ?? '').trim()
  const multiplex = multiplexOn(values)
  options.multiplex_min_streams = multiplex && values.multiplex_streams_kind !== 'max' ? streams : ''
  options.multiplex_max_streams = multiplex && values.multiplex_streams_kind === 'max' ? streams : ''

  // TLS options into the JSON of TLS fields
  if (typeof options.tls_fields === 'string' && options.tls_fields) {
    const tls = { enabled: true, ...parseObject(options.tls_fields) }
    for (const [option, write] of TLS_BINDINGS) if (option in options) write(tls, String(options[option]))
    options.tls_fields = jsonText(JSON.stringify(tls))
  }

  // the dial fields with options of their own into the JSON
  const dial: Record<string, unknown> = parseObject(String(values.dial_fields ?? '')) ?? {}
  for (const [key, field, , write] of DIAL_BINDINGS) {
    const value = write(String(values[key] ?? '').trim())
    if (value === undefined) delete dial[field]
    else dial[field] = value
  }
  options.dial_fields = jsonText(dial)

  for (const field of NODE_FIELDS) if (field.option && !(field.option in options) && !field.retain) options[field.option] = ''
  return options
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
