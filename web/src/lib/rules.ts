import { queryOptions } from '@tanstack/react-query'

import { deleteSections, findOutbound, findSubscription, list } from '@/lib/outbounds'
import { isGroup, label, type Profile, type Subscription } from '@/lib/policy'
import { addSection, apply, deleteOptions, getConfig, order, revert, setOptions, type UciSection } from '@/lib/uci'

// the route rules of a profile as the rules page edits them: standard rules
// of one condition, and logical ones with their conditions as route_subrule
// sections naming their id. The hidden rules Hako adds (sniffing, DNS
// hijacking, private addresses, the outbound modes) are not shown, and keep
// their places. The rule sets are sections of their own, which a rule_set
// condition names, as route.rule_set and the rule_set of a rule in sing-box

export const PROTOCOLS = ['http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp']

type Condition = {
  // what the value is called in a dialog; a flag has none
  label: string
  kind: 'list' | 'flag' | 'choice' | 'set'
  choices?: string[]
  valid?: (value: string) => boolean
}

function isHostname(value: string) {
  return /^\.?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.?$/.test(value)
}

function isRegex(value: string) {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

function isCidr(value: string) {
  const [address, prefix, ...rest] = value.split('/')
  if (rest.length || (prefix != null && !/^\d{1,3}$/.test(prefix))) return false
  if (address.includes(':')) return /^[0-9A-Fa-f:.]+$/.test(address) && (prefix == null || Number(prefix) <= 128)
  const octets = address.split('.')
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) && (prefix == null || Number(prefix) <= 32)
}

function isPort(value: string) {
  return /^\d{1,5}$/.test(value) && Number(value) <= 65535
}

function isRange(value: string) {
  const match = /^(\d*):(\d*)$/.exec(value)
  return !!match && (match[1] !== '' || match[2] !== '') && [match[1], match[2]].every((port) => port === '' || isPort(port))
}

export const CONDITIONS: Record<string, Condition> = {
  domain: { label: '域名', kind: 'list', valid: isHostname },
  domain_suffix: { label: '域名', kind: 'list', valid: isHostname },
  domain_keyword: { label: '关键字', kind: 'list' },
  domain_regex: { label: '正则', kind: 'list', valid: isRegex },
  ip_cidr: { label: '地址段', kind: 'list', valid: isCidr },
  ip_is_private: { label: '', kind: 'flag' },
  source_ip_cidr: { label: '地址段', kind: 'list', valid: isCidr },
  source_ip_is_private: { label: '', kind: 'flag' },
  source_mac_address: { label: 'MAC', kind: 'list', valid: (value) => /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(value) },
  source_hostname: { label: '设备名', kind: 'list' },
  port: { label: '端口', kind: 'list', valid: isPort },
  port_range: { label: '端口范围', kind: 'list', valid: isRange },
  source_port: { label: '端口', kind: 'list', valid: isPort },
  source_port_range: { label: '端口范围', kind: 'list', valid: isRange },
  network: { label: '网络', kind: 'choice', choices: ['tcp', 'udp'] },
  protocol: { label: '协议', kind: 'list', valid: (value) => PROTOCOLS.includes(value) },
  ip_version: { label: '版本', kind: 'choice', choices: ['4', '6'] },
  inbound: { label: '入站', kind: 'list' },
  auth_user: { label: '用户', kind: 'list' },
  // rule sets by section name, chosen from those there
  rule_set: { label: '规则集', kind: 'set' },
}

// the types of the menu, in groups
export const CONDITION_GROUPS = [
  ['domain', 'domain_suffix', 'domain_keyword', 'domain_regex'],
  ['ip_cidr', 'ip_is_private'],
  ['source_ip_cidr', 'source_ip_is_private', 'source_mac_address', 'source_hostname'],
  ['port', 'port_range', 'source_port', 'source_port_range'],
  ['network', 'protocol', 'ip_version', 'inbound', 'auth_user'],
  ['rule_set'],
]

// what a rule matches; clash_mode is for the hidden rules of the modes
const MATCH_KEYS = [...Object.keys(CONDITIONS), 'clash_mode']

// a rule_set condition matching the IP CIDRs of its rule sets against the
// source address, not the destination
export const MATCH_SOURCE = 'rule_set_ip_cidr_match_source'

// the values of a condition as a field takes them: a comma and spaces between
// them, a regex only at a comma and a space, as it may have commas itself
export function splitValues(key: string, text: string) {
  return text
    .split(key === 'domain_regex' ? /,\s+/ : /[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

export function validValues(key: string, values: string[]) {
  const condition = CONDITIONS[key]
  if (!condition || condition.kind === 'flag') return true
  return values.length > 0 && values.every((value) => !condition.valid || condition.valid(value))
}

export function conditionKeys(section: Record<string, unknown>) {
  return MATCH_KEYS.filter((key) => list(section[key] as string | string[] | undefined).some((value) => value !== ''))
}

// a condition as a dialog edits it: its values as text, a comma between
// them; a choice is one of its values, a flag has none
export function conditionValue(profile: Profile, key: string, options: Record<string, unknown>) {
  const values = list(options[key] as string | string[] | undefined)
  if (key === 'rule_set') return values.map((ref) => findRuleSet(profile, ref)?.['.name'] ?? ref).join(', ')
  if (CONDITIONS[key]?.kind === 'flag') return ''
  if (CONDITIONS[key]?.kind === 'choice') return values[0] ?? ''
  return values.join(', ')
}

export function conditionValues(key: string, text: string) {
  return CONDITIONS[key]?.kind === 'choice' ? (text ? [text] : []) : splitValues(key, text)
}

export function validCondition(profile: Profile, key: string, text: string) {
  const values = conditionValues(key, text)
  if (key === 'rule_set') return values.length > 0 && values.every((ref) => findRuleSet(profile, ref))
  return validValues(key, values)
}

// the value a type starts with when chosen
export function initialValue(key: string) {
  return CONDITIONS[key]?.kind === 'choice' ? CONDITIONS[key].choices![0] : ''
}

export type RuleKind = 'standard' | 'logical'

export function ruleKind(section: UciSection): RuleKind {
  return section.type === 'logical' ? 'logical' : 'standard'
}

export function visibleRules(profile: Profile) {
  return profile.sections.filter((section) => section['.type'] === 'route_rule' && section.hidden !== '1')
}

export function subrulesOf(profile: Profile, rule: UciSection) {
  return rule.id ? profile.sections.filter((section) => section['.type'] === 'route_subrule' && section.rule === rule.id) : []
}

export function ruleSets(profile: Profile) {
  return profile.sections.filter((section) => section['.type'] === 'rule_set')
}

export function findRuleSet(profile: Profile, ref: string) {
  const sets = ruleSets(profile)
  return sets.find((section) => section['.name'] === ref) ?? sets.find((section) => section.tag === ref)
}

function valuesText(profile: Profile, key: string, section: Record<string, unknown>) {
  if (CONDITIONS[key]?.kind === 'flag') return 'true'
  const values = list(section[key] as string | string[] | undefined)
  return (
    key === 'rule_set'
      ? values.map((ref) => {
          const set = findRuleSet(profile, ref)
          return set ? label(set) : ref
        })
      : values
  ).join(', ')
}

// a condition as a table shows it: its type, inverted as not, and values; one
// written as JSON as it is
export function conditionText(profile: Profile, options: Record<string, unknown>) {
  const not = options.invert === '1' ? 'not ' : ''
  if (typeof options.json === 'string') return { type: `${not}json`, value: options.json.replace(/\s+/g, ' ') }
  const keys = conditionKeys(options)
  if (keys.length === 1) return { type: `${not}${keys[0]}`, value: valuesText(profile, keys[0], options) }
  if (!keys.length) return { type: '-', value: '' }
  return { type: `${not}multiple`, value: keys.map((key) => `${key} ${valuesText(profile, key, options)}`).join('; ') }
}

// the mode of a logical rule, and or or as sing-box has them
export function logicalMode(section: UciSection) {
  return section.mode === 'or' ? 'or' : 'and'
}

export function ruleText(profile: Profile, section: UciSection) {
  if (section.type !== 'logical') return conditionText(profile, section)
  const joiner = section.mode === 'or' ? ' || ' : ' && '
  const value = subrulesOf(profile, section)
    .map((sub) => {
      const text = conditionText(profile, sub)
      return `(${text.type} ${text.value})`
    })
    .join(joiner)
  return { type: `${section.invert === '1' ? 'not ' : ''}${logicalMode(section)}`, value }
}

// the outbound of a rule as a dialog chooses it: reject, another action as
// it is, or the section of the outbound or subscription named
export const REJECT = '__reject'
const ACTION = '__action:'

export function outboundChoice(profile: Profile, subscriptions: Subscription[], section: UciSection) {
  const action = typeof section.action === 'string' && section.action ? section.action : 'route'
  if (action === 'reject') return REJECT
  if (action !== 'route') return ACTION + action
  const ref = typeof section.outbound === 'string' ? section.outbound : ''
  return findOutbound(profile, ref)?.['.name'] ?? findSubscription(subscriptions, ref)?.name ?? ref
}

// an outbound as the rules show it; the hidden direct ones of the profile in
// capitals, as REJECT, the way Surge shows DIRECT
function outboundLabel(section: UciSection) {
  return section.type === 'direct' && section.hidden === '1' ? label(section).toUpperCase() : label(section)
}

export function outboundText(profile: Profile, subscriptions: Subscription[], choice: string) {
  if (choice === REJECT) return 'REJECT'
  if (choice.startsWith(ACTION)) return choice.slice(ACTION.length)
  const section = findOutbound(profile, choice)
  if (section) return outboundLabel(section)
  return findSubscription(subscriptions, choice)?.tag ?? choice
}

export type ChoiceGroup = { title: string; items: [string, string][] }

// what a rule may use: the hidden nodes such as DIRECT and REJECT, then the
// nodes, the groups and the subscriptions; a new rule takes the first. One
// a rule has that is none of them stays a choice. The default outbound has
// no REJECT
export function outboundChoices(profile: Profile, subscriptions: Subscription[], current: string, reject = true): ChoiceGroup[] {
  const outbounds = profile.outbounds.filter((section) => section.type !== 'shadowtls')
  const named = (sections: UciSection[]) => sections.map((section): [string, string] => [section['.name'], outboundLabel(section)])
  const groups: ChoiceGroup[] = [
    {
      title: '',
      items: [
        ...named(outbounds.filter((section) => !isGroup(section) && section.hidden === '1')),
        ...(reject ? [[REJECT, 'REJECT'] as [string, string]] : []),
      ],
    },
    { title: '节点', items: named(outbounds.filter((section) => !isGroup(section) && section.hidden !== '1')) },
    { title: '策略组', items: named(outbounds.filter((section) => isGroup(section) && section.hidden !== '1')) },
    { title: '订阅', items: subscriptions.filter((sub) => sub.enabled).map((sub): [string, string] => [sub.name, sub.tag]) },
  ]
  if (current && !groups.some((group) => group.items.some(([value]) => value === current)))
    groups[0].items.unshift([current, outboundText(profile, subscriptions, current)])
  return groups.filter((group) => group.items.length)
}

// the options of a rule for its outbound; an empty one is removed
function actionOptions(choice: string, drop: boolean): Record<string, string> {
  if (choice === REJECT) return { action: 'reject', outbound: '', method: drop ? 'drop' : '' }
  if (choice.startsWith(ACTION)) return { action: choice.slice(ACTION.length), outbound: '', method: '' }
  return { action: '', outbound: choice, method: '' }
}

// the conditions a rule has no more
function clearedConditions() {
  return Object.fromEntries([...MATCH_KEYS.filter((key) => key !== 'clash_mode'), MATCH_SOURCE].map((key) => [key, '']))
}

// a section written: the options with a value set, those empty removed. A new
// one is added at the end, and named when a name is given
async function writeSection(config: string, section: UciSection | null, type: string, values: Record<string, string | string[]>, name?: string) {
  const set: Record<string, string | string[]> = {}
  const unset: string[] = []
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) ? value.length : value !== '') set[key] = value
    else if (section && section[key] != null) unset.push(key)
  }
  if (!section) return addSection(config, type, set, name)
  if (Object.keys(set).length) await setOptions(config, section['.name'], set)
  if (unset.length) await deleteOptions(config, section['.name'], unset)
  return section['.name']
}

// the inbounds of the device settings, which may name rule sets of the
// profile: the routes tun takes, or leaves, by rule sets
const INBOUND_RULE_SETS = ['route_address_set', 'route_exclude_address_set']

async function deviceInbounds() {
  const sections = await getConfig('hako').catch(() => [])
  return sections.filter((section) => section['.type'] === 'inbound')
}

// changes made, then applied, which reloads sing-box; reverted when one fails
async function applying(config: string, change: () => Promise<void>) {
  try {
    await change()
    await apply()
  } catch (error) {
    await revert(config).catch(() => {})
    await revert('hako').catch(() => {})
    throw error
  }
}

export type StandardValues = {
  // the type of the condition; none for a rule of several, kept as they are
  key: string
  values: string[]
  // for a rule_set condition: its IP CIDRs match the source address
  matchSource: boolean
  invert: boolean
  outbound: string
  drop: boolean
  comment: string
}

export function conditionOptions(profile: Profile, key: string, values: string[]): Record<string, string | string[]> {
  if (CONDITIONS[key]?.kind === 'flag') return { [key]: '1' }
  if (key === 'rule_set') return { [key]: values.map((ref) => findRuleSet(profile, ref)?.['.name'] ?? ref) }
  return { [key]: values }
}

// a standard rule saved, which a logical one may have been: its conditions go
export async function saveStandardRule(profile: Profile, section: UciSection | null, values: StandardValues) {
  const { config } = profile
  await applying(config, async () => {
    const options = {
      ...(values.key
        ? {
            ...clearedConditions(),
            ...conditionOptions(profile, values.key, values.values),
            [MATCH_SOURCE]: values.key === 'rule_set' && values.matchSource ? '1' : '',
          }
        : {}),
      type: '',
      mode: '',
      id: '',
      invert: values.invert ? '1' : '',
      comment: values.comment.trim(),
      ...actionOptions(values.outbound, values.drop),
    }
    if (section) {
      const subrules = subrulesOf(profile, section)
      if (subrules.length) await deleteSections(profile, subrules, await deviceInbounds())
    }
    await writeSection(config, section, 'route_rule', options)
  })
}

export type LogicalValues = {
  mode: 'and' | 'or'
  invert: boolean
  outbound: string
  drop: boolean
  comment: string
  // the options of each condition, but the rule they belong to
  conditions: Record<string, string | string[]>[]
}

function newId(profile: Profile) {
  const taken = new Set(profile.sections.map((section) => section.id))
  for (;;) {
    const id = Math.random().toString(16).slice(2, 10)
    if (!taken.has(id)) return id
  }
}

// a logical rule saved, its conditions written again in their order
export async function saveLogicalRule(profile: Profile, section: UciSection | null, values: LogicalValues) {
  const { config } = profile
  await applying(config, async () => {
    const id = (section?.type === 'logical' && typeof section.id === 'string' && section.id) || newId(profile)
    if (section) {
      const subrules = subrulesOf(profile, section)
      if (subrules.length) await deleteSections(profile, subrules, await deviceInbounds())
    }
    await writeSection(config, section, 'route_rule', {
      ...clearedConditions(),
      type: 'logical',
      mode: values.mode,
      invert: values.invert ? '1' : '',
      id,
      comment: values.comment.trim(),
      ...actionOptions(values.outbound, values.drop),
    })
    for (const condition of values.conditions) await addSection(config, 'route_subrule', { ...condition, rule: id })
  })
}

// a rule deleted with its conditions
export async function deleteRule(profile: Profile, section: UciSection) {
  await applying(profile.config, async () => {
    await deleteSections(profile, [section, ...subrulesOf(profile, section)], await deviceInbounds())
  })
}

// the rule sets: where a rule set is, as sing-box has them, and the format of
// a file, which sing-box needs to be told

export const RULE_SET_TYPES = { remote: '远程', local: '本地', inline: '内联' }
export type RuleSetType = keyof typeof RULE_SET_TYPES
export const RULE_SET_FORMATS = ['binary', 'source']

export function ruleSetType(set: UciSection): RuleSetType {
  return typeof set.type === 'string' && set.type in RULE_SET_TYPES ? (set.type as RuleSetType) : 'local'
}

// the format of a rule set file; one written without, by the extension of its
// file, as sing-box guessed it. An inline rule set has none
export function ruleSetFormat(set: UciSection | null | undefined) {
  if (set && ruleSetType(set) === 'inline') return ''
  if (typeof set?.format === 'string' && RULE_SET_FORMATS.includes(set.format)) return set.format
  const file = String(set?.url ?? set?.path ?? '')
  return /\.json(\?.*)?$/i.test(file) ? 'source' : 'binary'
}

// where a rule set is: its address, its path, or its rules
export function ruleSetSource(set: UciSection) {
  const type = ruleSetType(set)
  const value = type === 'remote' ? set.url : type === 'local' ? set.path : set.rules
  return typeof value === 'string' ? value.replace(/\s+/g, ' ') : ''
}

export const inboundsQuery = queryOptions({
  queryKey: ['hako', 'inbounds'],
  queryFn: deviceInbounds,
})

// what uses a rule set, which keeps it from being deleted: the rules and the
// conditions naming it, the DNS rules, and the routes of tun
export function ruleSetUsers(profile: Profile, inbounds: UciSection[], set: UciSection) {
  const refers = (refs: string | string[] | undefined) => list(refs).some((ref) => ref === set['.name'] || ref === set.tag)
  const users: string[] = []
  let hidden = 0
  let dns = 0
  const rule = (section: UciSection) => {
    const text = ruleText(profile, section)
    return `规则：${section.comment || `${text.type} ${text.value}`}`
  }
  for (const section of profile.sections) {
    if (!refers(section.rule_set)) continue
    const type = section['.type']
    if (type === 'route_rule') {
      if (section.hidden === '1') hidden++
      else users.push(rule(section))
    } else if (type === 'route_subrule') {
      const logical = profile.sections.find((other) => other['.type'] === 'route_rule' && other.type === 'logical' && other.id === section.rule)
      if (logical?.hidden === '1') hidden++
      else users.push(logical ? rule(logical) : '逻辑规则的条件')
    } else if (type === 'dns_rule') dns++
  }
  if (hidden) users.push(`内置路由规则 ${hidden} 条`)
  if (dns) users.push(`DNS 规则 ${dns} 条`)
  for (const inbound of inbounds) {
    const name = inbound.type === 'tun' ? 'TUN' : label(inbound)
    if (refers(inbound.route_address_set)) users.push(`接管：${name} 接管的规则集`)
    if (refers(inbound.route_exclude_address_set)) users.push(`接管：${name} 绕过的规则集`)
  }
  // a logical rule naming it in more than one condition, once
  return [...new Set(users)]
}

export type RuleSetValues = {
  tag: string
  type: RuleSetType
  format: string
  url: string
  path: string
  rules: string
  // hours
  interval: string
  client: string
}

// update intervals are hours, as the dialog takes them; another duration is
// kept as it is
export function intervalHours(value: string | string[] | undefined) {
  const text = typeof value === 'string' ? value : ''
  const match = /^(\d+)h$/.exec(text)
  return match ? match[1] : text
}

function intervalValue(hours: string) {
  const value = hours.trim()
  return /^\d+$/.test(value) ? (Number(value) > 0 ? `${value}h` : '') : value
}

// a rule set saved. What named it by its tag names it by its section then, so
// that a new tag leaves it as it is
export async function saveRuleSet(profile: Profile, section: UciSection | null, values: RuleSetValues) {
  const { config } = profile
  const tag = values.tag.trim()
  await applying(config, async () => {
    const remote = values.type === 'remote'
    const name = await writeSection(
      config,
      section,
      'rule_set',
      {
        tag,
        type: values.type,
        format: values.type === 'inline' ? '' : values.format,
        url: remote ? values.url.trim() : '',
        path: values.type === 'local' ? values.path.trim() : '',
        rules: values.type === 'inline' ? values.rules.trim() : '',
        update_interval: remote ? intervalValue(values.interval) : '',
        http_client: remote ? values.client : '',
        initial_path: remote && section ? ((section.initial_path as string) ?? '') : '',
      },
      `rule_set_${Date.now()}`,
    )

    const old = typeof section?.tag === 'string' ? section.tag : ''
    if (!old || old === tag) return
    const renamed = (refs: string | string[] | undefined) => list(refs).map((ref) => (ref === old ? name : ref))
    for (const other of profile.sections)
      if (['route_rule', 'route_subrule', 'dns_rule'].includes(other['.type']) && list(other.rule_set).includes(old))
        await setOptions(config, other['.name'], { rule_set: renamed(other.rule_set) })
    for (const inbound of await deviceInbounds())
      for (const key of INBOUND_RULE_SETS) if (list(inbound[key]).includes(old)) await setOptions('hako', inbound['.name'], { [key]: renamed(inbound[key]) })
  })
}

// a rule set nothing uses deleted
export async function deleteRuleSet(profile: Profile, section: UciSection) {
  await applying(profile.config, async () => {
    const inbounds = await deviceInbounds()
    if (ruleSetUsers(profile, inbounds, section).length) throw new Error('规则集仍在使用')
    await deleteSections(profile, [section], inbounds)
  })
}

export async function setRuleEnabled(profile: Profile, section: UciSection, enabled: boolean) {
  await applying(profile.config, async () => {
    if (enabled) await deleteOptions(profile.config, section['.name'], ['enabled'])
    else await setOptions(profile.config, section['.name'], { enabled: '0' })
  })
}

// the rules shown in a new order, in the places they had among the sections
export async function reorderRules(profile: Profile, names: string[]) {
  const all = profile.sections.map((section) => section['.name'])
  const shown = new Set(visibleRules(profile).map((section) => section['.name']))
  const slots = all.flatMap((name, index) => (shown.has(name) ? [index] : []))
  slots.forEach((slot, index) => (all[slot] = names[index]))
  await applying(profile.config, () => order(profile.config, all).then(() => {}))
}

export function routeSection(profile: Profile) {
  return profile.sections.find((section) => section['.type'] === 'route')
}

// the fields of the route besides its rules and rule sets that a router has
// a use for, in the order of sing-box. auto_detect_interface, which the
// takeover needs, the generator always turns on
export type RouteValues = {
  // the outbound of what matches no rule
  final: string
  // the MAC address and host name of LAN devices, in the log
  findNeighbor: boolean
  // a space between them
  leaseFiles: string
  // empty for the first http client
  httpClient: string
  domainResolver: string
}

export function routeValues(profile: Profile, subscriptions: Subscription[]): RouteValues {
  const route = routeSection(profile)
  return {
    final: finalChoice(profile, subscriptions),
    // on unless switched off, as the template has it
    findNeighbor: route?.find_neighbor !== '0',
    leaseFiles: list(route?.dhcp_lease_files).join(' '),
    httpClient: typeof route?.default_http_client === 'string' ? route.default_http_client : '',
    domainResolver: typeof route?.default_domain_resolver === 'string' ? route.default_domain_resolver : '',
  }
}

export async function saveRoute(profile: Profile, values: RouteValues) {
  const { config } = profile
  await applying(config, async () => {
    await writeSection(
      config,
      routeSection(profile) ?? null,
      'route',
      {
        final: values.final,
        find_neighbor: values.findNeighbor ? '1' : '0',
        dhcp_lease_files: values.leaseFiles.split(/[\s,]+/).filter(Boolean),
        default_http_client: values.httpClient,
        default_domain_resolver: values.domainResolver,
      },
      'route',
    )
  })
}

export function finalChoice(profile: Profile, subscriptions: Subscription[]) {
  const ref = String(routeSection(profile)?.final ?? '')
  return findOutbound(profile, ref)?.['.name'] ?? findSubscription(subscriptions, ref)?.name ?? ref
}

export function httpClients(profile: Profile) {
  return profile.sections.filter((section) => section['.type'] === 'http_client')
}

// the DNS servers that may resolve the domains of the outbounds: direct, as
// the nodes are not up yet, and not local or fakeip, as while sing-box runs
// dnsmasq sends its queries back to it
export function domainResolvers(profile: Profile) {
  return profile.sections.filter((section) => section['.type'] === 'dns_server' && !['fakeip', 'local'].includes(String(section.type)) && !section.detour)
}
