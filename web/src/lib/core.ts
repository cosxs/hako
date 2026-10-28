import { queryOptions } from '@tanstack/react-query'

import { deleteSections, list } from '@/lib/outbounds'
import { label, type Profile } from '@/lib/policy'
import { applying, getConfig, getSection, writeSection, type UciSection } from '@/lib/uci'

// the core settings: the objects of the sing-box config besides the
// outbounds and the route, each a section of the profile as sing-box has it
// (log, dns, ntp, the DNS servers, the HTTP clients and the API services);
// the Clash API and the cache file, experimental, are of the device, in hako

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic']

export const STRATEGIES: Record<string, string> = {
  '': '默认',
  prefer_ipv4: '优先 IPv4',
  prefer_ipv6: '优先 IPv6',
  ipv4_only: '仅 IPv4',
  ipv6_only: '仅 IPv6',
}

// the types of the DNS servers added by hand, named as in the sing-box
// documentation; local and fakeip are built in
export const DNS_TYPES: Record<string, string> = {
  udp: 'UDP',
  tcp: 'TCP',
  tls: 'TLS',
  quic: 'QUIC',
  https: 'HTTPS',
  h3: 'HTTP/3',
}

// the address ranges of a fakeip server added by the FakeIP switch, as in the
// template
const FAKEIP_RANGES = { inet4_range: '198.18.0.0/15', inet6_range: '2001:2::/48' }
export const REMOTE_DNS_TYPES = ['udp', 'tcp', 'tls', 'quic', 'https', 'h3']
export const TLS_DNS_TYPES = ['tls', 'quic', 'https', 'h3']

// words joined as Chinese text has them: a space before a Latin one
export function joined(before: string, word: string) {
  return /^[A-Za-z0-9]/.test(word) ? `${before} ${word}` : `${before}${word}`
}

function text(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

function sectionOf(profile: Profile, type: string) {
  return profile.sections.find((section) => section['.type'] === type) ?? null
}

export function sectionsOf(profile: Profile, type: string) {
  return profile.sections.filter((section) => section['.type'] === type)
}

// a duration in one unit, as a field takes it: "30m" is 30 in minutes;
// another duration is kept as it is
export function durationIn(value: string | string[] | undefined, unit: string) {
  const match = new RegExp(`^(\\d+)${unit}$`).exec(text(value))
  return match ? match[1] : text(value)
}

function durationValue(input: string, unit: string) {
  const value = input.trim()
  return /^\d+$/.test(value) ? (Number(value) > 0 ? `${value}${unit}` : '') : value
}

// a JSON object of sing-box fields, or nothing
export function validJsonObject(text: string) {
  if (!text.trim()) return true
  try {
    const value = JSON.parse(text)
    return !!value && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

export function validDuration(input: string) {
  return /^(\d*|(\d+(ns|us|µs|ms|s|m|h|d))+)$/.test(input.trim())
}

// the outbounds a dial detour may take, by section name: sing-box refuses a
// plain direct one, and none is direct already; a hidden group is a mode's
export function detourChoices(profile: Profile): Record<string, string> {
  return Object.fromEntries([
    ['', '直连（默认）'],
    ...profile.outbounds.filter((section) => section.type !== 'direct' && section.hidden !== '1').map((section) => [section['.name'], label(section)]),
  ])
}

// a reference to a section by name or tag
function refersTo(section: UciSection) {
  return (refs: string | string[] | undefined) => list(refs).some((ref) => ref === section['.name'] || ref === section.tag)
}

// log

export type LogValues = { disabled: boolean; level: string; timestamp: boolean }

export function logValues(profile: Profile): LogValues {
  const log = sectionOf(profile, 'log')
  return { disabled: log?.disabled === '1', level: text(log?.level) || 'warn', timestamp: log?.timestamp !== '0' }
}

export async function saveLog(profile: Profile, values: LogValues) {
  await applying(profile.config, () =>
    writeSection(
      profile.config,
      sectionOf(profile, 'log'),
      'log',
      { disabled: values.disabled ? '1' : '', level: values.level, timestamp: values.timestamp ? '1' : '0' },
      'log',
    ),
  )
}

// DNS

// fakeip answers the foreign domains, those whose answer from the system DNS
// is not in the mainland, or another server of foreignServer answers them:
// the server of the foreign and fallback DNS rules of the template; the
// address ranges are those of the fakeip server
export type DnsValues = {
  final: string
  fakeip: boolean
  fakeip4: string
  fakeip6: string
  foreignServer: string
  strategy: string
  optimistic: boolean
  customRules: string
}

const CIDR4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([12]?\d|3[0-2])$/
const CIDR6 = /^[0-9a-f:]*:[0-9a-f:.]*\/(12[0-8]|1[01]\d|\d?\d)$/i

export const validCidr4 = (input: string) => !input.trim() || CIDR4.test(input.trim())
export const validCidr6 = (input: string) => !input.trim() || CIDR6.test(input.trim())

const FOREIGN_RULES = ['foreign', 'fallback']

export function foreignRules(profile: Profile) {
  return profile.sections.filter((section) => section['.type'] === 'dns_rule' && FOREIGN_RULES.includes(section['.name']))
}

export function fakeipServer(profile: Profile) {
  return sectionsOf(profile, 'dns_server').find((section) => section.type === 'fakeip') ?? null
}

// the servers that may answer the foreign domains with real addresses
export function foreignServers(profile: Profile) {
  return sectionsOf(profile, 'dns_server').filter((section) => section.type !== 'fakeip')
}

export function dnsValues(profile: Profile): DnsValues {
  const dns = sectionOf(profile, 'dns')
  const server = text(foreignRules(profile)[0]?.server)
  const fake = sectionsOf(profile, 'dns_server').find((section) => section['.name'] === server || section.tag === server)
  const fakeip = !server || fake?.type === 'fakeip'
  // a profile without a fakeip server gets one with the ranges of the
  // template once the switch is on
  const ranges = fakeipServer(profile) ?? FAKEIP_RANGES
  return {
    final: text(dns?.final),
    fakeip,
    fakeip4: text(ranges.inet4_range),
    fakeip6: text(ranges.inet6_range),
    foreignServer: fakeip ? '' : server,
    strategy: text(dns?.strategy),
    optimistic: dns?.optimistic !== '0',
    customRules: text(dns?.custom_rules),
  }
}

// the default DNS server answers what no rule sends elsewhere: not fakeip,
// which answers A and AAAA only
export function finalServers(profile: Profile) {
  return sectionsOf(profile, 'dns_server').filter((section) => section.type !== 'fakeip')
}

export async function saveDns(profile: Profile, values: DnsValues) {
  const rules = values.customRules.trim()
  const fake = fakeipServer(profile)
  await applying(profile.config, async () => {
    await writeSection(
      profile.config,
      sectionOf(profile, 'dns'),
      'dns',
      {
        final: values.final,
        strategy: values.strategy,
        optimistic: values.optimistic ? '1' : '0',
        // as written, but none when it is an empty array
        custom_rules: rules && !/^\[\s*\]$/.test(rules) ? rules : '',
      },
      'dns',
    )
    // fake addresses are answered with a TTL of 1 second, so devices hardly
    // cache them and get real ones as soon as Hako stops
    // the FakeIP switch adds the fakeip server when there is none; off, the
    // server stays with its ranges, which no rule uses
    const ranges = { inet4_range: values.fakeip4.trim(), inet6_range: values.fakeip6.trim() }
    const fakeName = fake
      ? await writeSection(profile.config, fake, 'dns_server', ranges)
      : values.fakeip
        ? await writeSection(profile.config, null, 'dns_server', { tag: 'fakeip', type: 'fakeip', ...ranges }, 'fakeip')
        : ''
    const server = values.fakeip ? fakeName : values.foreignServer
    if (server)
      for (const rule of foreignRules(profile)) await writeSection(profile.config, rule, 'dns_rule', { server, rewrite_ttl: values.fakeip ? '1' : '' })
  })
}

export type DnsServerValues = {
  tag: string
  type: string
  server: string
  port: string
  path: string
  tlsServerName: string
  detour: string
  domainResolver: string
}

export function dnsServerValues(section: UciSection | null): DnsServerValues {
  return {
    tag: text(section?.tag),
    type: text(section?.type) || 'udp',
    server: text(section?.server),
    port: text(section?.server_port),
    path: text(section?.path),
    tlsServerName: text(section?.tls_server_name),
    detour: text(section?.detour),
    domainResolver: text(section?.domain_resolver),
  }
}

export async function saveDnsServer(profile: Profile, section: UciSection | null, values: DnsServerValues) {
  const remote = REMOTE_DNS_TYPES.includes(values.type)
  await applying(profile.config, () =>
    writeSection(
      profile.config,
      section,
      'dns_server',
      {
        tag: values.tag.trim(),
        type: values.type,
        server: remote ? values.server.trim() : '',
        server_port: remote ? values.port.trim() : '',
        path: ['https', 'h3'].includes(values.type) ? values.path.trim() : '',
        tls_server_name: TLS_DNS_TYPES.includes(values.type) ? values.tlsServerName.trim() : '',
        detour: values.detour,
        domain_resolver: values.domainResolver,
      },
      `dns_${Date.now()}`,
    ),
  )
}

// what uses a DNS server, which keeps it from being deleted
export function dnsServerUsers(profile: Profile, server: UciSection) {
  const refers = refersTo(server)
  const users: string[] = []
  let rules = 0
  for (const section of profile.sections) {
    if (section === server) continue
    const type = section['.type']
    if (type === 'dns' && refers(section.final)) users.push('DNS：默认 DNS 服务器')
    if (type === 'route' && refers(section.default_domain_resolver)) users.push('路由：默认域名解析服务器')
    if (type === 'dns_rule' && refers(section.server)) rules++
    if (type === 'dns_server' && refers(section.domain_resolver)) users.push(`DNS 服务器 ${label(section)}：域名解析`)
    if (type === 'ntp' && refers(section.domain_resolver)) users.push('NTP：域名解析')
  }
  if (rules) users.push(`DNS 规则 ${rules} 条`)
  return users
}

// HTTP clients: what remote rule sets, Hysteria2 realms and dashboards
// download with; the dial fields, TLS fields and the tuning of HTTP2 and QUIC
// are kept as they are

export type HttpClientValues = { tag: string; version: string; noFallback: boolean; headers: string; detour: string }

function dialFields(section: UciSection | null): Record<string, unknown> {
  try {
    const fields = JSON.parse(text(section?.dial_fields) || '{}')
    return fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {}
  } catch {
    return {}
  }
}

export function httpClientValues(profile: Profile, section: UciSection | null): HttpClientValues {
  const detour = dialFields(section).detour
  // the outbound by its tag, as sing-box has it in the dial fields
  const outbound = typeof detour === 'string' ? profile.outbounds.find((other) => label(other) === detour || other['.name'] === detour) : undefined
  return {
    tag: text(section?.tag),
    version: text(section?.version) || '2',
    noFallback: section?.disable_version_fallback === '1',
    headers: list(section?.headers).join('\n'),
    detour: outbound ? outbound['.name'] : typeof detour === 'string' ? detour : '',
  }
}

export async function saveHttpClient(profile: Profile, section: UciSection | null, values: HttpClientValues) {
  const fields = dialFields(section)
  const outbound = profile.outbounds.find((other) => other['.name'] === values.detour)
  if (values.detour) fields.detour = outbound ? label(outbound) : values.detour
  else delete fields.detour
  await applying(profile.config, () =>
    writeSection(
      profile.config,
      section,
      'http_client',
      {
        tag: values.tag.trim(),
        version: values.version,
        disable_version_fallback: values.noFallback ? '1' : '',
        headers: values.headers
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        dial_fields: Object.keys(fields).length ? JSON.stringify(fields, null, 2) : '',
      },
      `http_client_${Date.now()}`,
    ),
  )
}

export function httpClientUsers(profile: Profile, client: UciSection) {
  const refers = refersTo(client)
  const users: string[] = []
  for (const section of profile.sections) {
    const type = section['.type']
    if (type === 'route' && refers(section.default_http_client)) users.push('路由：默认 HTTP 客户端')
    if (type === 'rule_set' && refers(section.http_client)) users.push(`规则集 ${label(section)}：下载方式`)
    if (type === 'service' && refers(section.dashboard_http_client)) users.push(`API ${label(section)}：面板下载`)
  }
  return users
}

// the sing-box API, services of type api; their TLS and further fields are
// kept as they are

export type ServiceValues = {
  enabled: boolean
  tag: string
  listen: string
  port: string
  secret: string
  origins: string
  privateNetwork: boolean
  dashboard: boolean
  dashboardPath: string
  dashboardUrl: string
  dashboardClient: string
  // hours
  dashboardInterval: string
}

// where a dashboard is kept, across reboots and upgrades as /etc/hako is,
// and sing-box downloads it from
export const DASHBOARD_PATH = '/etc/hako/dashboard'
export const DASHBOARD_URL = 'https://github.com/SagerNet/sing-box-dashboard/archive/refs/heads/gh-pages.zip'

// a new API has its dashboard off, filled in for when it is switched on
export function serviceValues(section: UciSection | null): ServiceValues {
  if (!section)
    return {
      enabled: true,
      tag: '',
      listen: '',
      port: '',
      secret: '',
      origins: '',
      privateNetwork: false,
      dashboard: false,
      dashboardPath: DASHBOARD_PATH,
      dashboardUrl: DASHBOARD_URL,
      dashboardClient: '',
      dashboardInterval: '24',
    }
  return {
    enabled: section?.enabled !== '0',
    tag: text(section?.tag),
    listen: text(section?.listen),
    port: text(section?.listen_port),
    secret: text(section?.secret),
    origins: list(section?.access_control_allow_origin).join(' '),
    privateNetwork: section?.access_control_allow_private_network === '1',
    dashboard: section?.dashboard === '1',
    dashboardPath: text(section?.dashboard_path),
    dashboardUrl: text(section?.dashboard_download_url),
    dashboardClient: text(section?.dashboard_http_client),
    dashboardInterval: durationIn(section?.dashboard_update_interval, 'h'),
  }
}

export async function saveService(profile: Profile, section: UciSection | null, values: ServiceValues) {
  await applying(profile.config, () =>
    writeSection(
      profile.config,
      section,
      'service',
      {
        enabled: values.enabled ? '' : '0',
        tag: values.tag.trim(),
        listen: values.listen.trim(),
        listen_port: values.port.trim(),
        secret: values.secret,
        access_control_allow_origin: values.origins.split(/[\s,]+/).filter(Boolean),
        access_control_allow_private_network: values.privateNetwork ? '1' : '',
        dashboard: values.dashboard ? '1' : '',
        // kept while the dashboard is off
        dashboard_path: values.dashboardPath.trim(),
        dashboard_download_url: values.dashboardUrl.trim(),
        dashboard_http_client: values.dashboardClient,
        dashboard_update_interval: durationValue(values.dashboardInterval, 'h'),
      },
      `service_${Date.now()}`,
    ),
  )
}

// a section of the profile deleted, as nothing uses it; what refers to an
// anonymous one after it takes its new name
export async function deleteProfileSection(profile: Profile, section: UciSection) {
  const inbounds = (await getConfig('hako').catch(() => [])).filter((other) => other['.type'] === 'inbound')
  await applying(profile.config, () => deleteSections(profile, [section], inbounds))
}

// NTP

// the dial fields written as JSON, an object of sing-box fields; detour and
// domain_resolver, options of their own of earlier versions, are kept
export type NtpValues = { enabled: boolean; server: string; port: string; interval: string; dialFields: string }

export function ntpValues(profile: Profile): NtpValues {
  const ntp = sectionOf(profile, 'ntp')
  return {
    enabled: ntp?.enabled === '1',
    server: text(ntp?.server),
    port: text(ntp?.server_port) || '123',
    interval: durationIn(ntp?.interval, 'm') || '30',
    dialFields: text(ntp?.dial_fields),
  }
}

export async function saveNtp(profile: Profile, values: NtpValues) {
  await applying(profile.config, () =>
    writeSection(
      profile.config,
      sectionOf(profile, 'ntp'),
      'ntp',
      {
        enabled: values.enabled ? '1' : '0',
        // kept while NTP is off
        server: values.server.trim(),
        server_port: values.port.trim(),
        interval: durationValue(values.interval, 'm'),
        // none when empty
        dial_fields: /^\{\s*\}$/.test(values.dialFields.trim()) ? '' : values.dialFields.trim(),
      },
      'ntp',
    ),
  )
}

// experimental: the Clash API and the cache file, of the device

export type ExperimentalValues = {
  controller: string
  secret: string
  uiPath: string
  uiUrl: string
  uiDetour: string
  privateNetwork: boolean
  cache: boolean
  cachePath: string
  cacheId: string
  storeFakeip: boolean
  storeDns: boolean
}

export const experimentalQuery = queryOptions({
  queryKey: ['hako', 'experimental'],
  queryFn: async (): Promise<ExperimentalValues> => {
    const clash = await getSection('hako', 'clash_api').catch(() => null)
    const cache = await getSection('hako', 'cache_file').catch(() => null)
    return {
      controller: text(clash?.external_controller),
      secret: text(clash?.secret),
      uiPath: text(clash?.external_ui),
      uiUrl: text(clash?.external_ui_download_url),
      uiDetour: text(clash?.external_ui_download_detour),
      privateNetwork: clash?.access_control_allow_private_network === '1',
      cache: cache?.enabled !== '0',
      cachePath: text(cache?.path),
      cacheId: text(cache?.cache_id),
      storeFakeip: cache?.store_fakeip === '1',
      storeDns: cache?.store_dns === '1',
    }
  },
})

export async function saveExperimental(values: ExperimentalValues) {
  const sections = await getConfig('hako')
  const find = (name: string) => sections.find((section) => section['.name'] === name) ?? null
  await applying('hako', async () => {
    await writeSection(
      'hako',
      find('clash_api'),
      'experimental',
      {
        external_controller: values.controller.trim(),
        secret: values.secret,
        external_ui: values.uiPath.trim(),
        external_ui_download_url: values.uiUrl.trim(),
        external_ui_download_detour: values.uiDetour,
        access_control_allow_private_network: values.privateNetwork ? '1' : '',
      },
      'clash_api',
    )
    await writeSection(
      'hako',
      find('cache_file'),
      'experimental',
      {
        enabled: values.cache ? '1' : '0',
        // kept while the cache file is off
        path: values.cachePath.trim(),
        cache_id: values.cacheId.trim(),
        store_fakeip: values.storeFakeip ? '1' : '',
        store_dns: values.storeDns ? '1' : '',
      },
      'cache_file',
    )
  })
}
