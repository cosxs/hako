import { isGroup, label, type Profile, type Subscription } from '@/lib/policy'
import { addSection, apply, deleteOptions, deleteSection, revert, setOptions, type UciSection } from '@/lib/uci'

// editing the outbounds of a profile, groups and nodes alike. A reference to
// an outbound is its section name or its tag, as the generator looks one up

export function list(value: string | string[] | undefined) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value : [value]
}

// the outbound a reference names: a group or node of the profile
export function findOutbound(profile: Profile, ref: string) {
  return profile.outbounds.find((section) => section['.name'] === ref) ?? profile.outbounds.find((section) => section.tag === ref)
}

export function findSubscription(subscriptions: Subscription[], ref: string) {
  return subscriptions.find((sub) => sub.name === ref) ?? subscriptions.find((sub) => sub.tag === ref)
}

function refers(value: string | string[] | undefined, section: UciSection) {
  return list(value).some((ref) => ref === section['.name'] || ref === label(section))
}

// the groups that contain a group, directly or through others, as the
// generator finds them: a group contains those it lists, and a hidden one
// every group not hidden. One of them listed by the group makes a loop
export function groupContainers(profile: Profile, name: string | null) {
  const groups = profile.outbounds.filter(isGroup)
  const contains = (group: UciSection, member: UciSection) =>
    group !== member && (refers(group.outbounds, member) || (group.hidden === '1' && member.hidden !== '1'))
  const containers = new Set<UciSection>()
  const self = groups.find((group) => group['.name'] === name)
  if (!self) return containers

  for (let grown = true; grown;) {
    grown = false
    for (const group of groups)
      if (group !== self && !containers.has(group) && [self, ...containers].some((member) => contains(group, member))) {
        containers.add(group)
        grown = true
      }
  }
  return containers
}

// what uses an outbound: the groups that list it or default to it, which
// deleting it leaves without it, and the rest by where it is, which keep it
// from being deleted: a rule or anything connecting through it would go
// elsewhere unnoticed
export function outboundUsers(profile: Profile, section: UciSection) {
  const groups = profile.outbounds.filter(
    (group) => isGroup(group) && group !== section && (refers(group.outbounds, section) || refers(group.default, section)),
  )
  const blockers: string[] = []

  for (const other of profile.sections) {
    if (other === section) continue
    const type = other['.type']
    if (type === 'route_rule' && other.outbound != null && refers(other.outbound, section)) blockers.push(`规则：${describeRule(other)}`)
    if (type === 'route' && refers(other.final, section)) blockers.push('路由：默认出站')
    if (other.detour != null && refers(other.detour, section)) blockers.push(`${SECTION_NAMES[type] ?? type} ${label(other)}：经由它连接`)
    if (type === 'outbound' && typeof other.dial_fields === 'string' && dialDetour(other.dial_fields) && refers(dialDetour(other.dial_fields), section))
      blockers.push(`节点 ${label(other)}：经由它拨号`)
  }
  if (profile.clashDetour && refers(profile.clashDetour, section)) blockers.push('Clash API：经由它下载面板')

  return { groups, blockers }
}

const SECTION_NAMES: Record<string, string> = { dns_server: 'DNS 服务器', ntp: 'NTP', http_client: 'HTTP 客户端', outbound: '节点' }

// the options of a rule that are no condition
const RULE_OPTIONS = new Set(['action', 'outbound', 'hidden', 'enabled', 'comment', 'type', 'mode', 'id', 'invert', 'method'])

// a rule as its comment, or else its first condition
export function describeRule(rule: UciSection) {
  if (rule.comment) return String(rule.comment)
  const key = Object.keys(rule).find((key) => !key.startsWith('.') && !RULE_OPTIONS.has(key))
  if (!key) return '没有条件的规则'
  const values = list(rule[key])
  return `${key} ${values.slice(0, 3).join('、')}${values.length > 3 ? ' 等' : ''}`
}

function dialDetour(json: string) {
  try {
    const fields = JSON.parse(json)
    return typeof fields?.detour === 'string' ? (fields.detour as string) : undefined
  } catch {
    return undefined
  }
}

// a section saved: the options with a value set, the others removed, then
// applied, which reloads sing-box. The options not given are kept. Changes
// left by a failure are reverted. A new one is named, as kind and the time:
// other sections refer to it by name, and the name of an anonymous one
// changes as sections before it come and go
export async function saveOutbound(config: string, section: UciSection | null, values: Record<string, string | string[]>, kind = 'outbound') {
  const set: Record<string, string | string[]> = {}
  const unset: string[] = []
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value) ? value.length : value !== '') set[key] = value
    else if (section && section[key] != null) unset.push(key)
  }

  try {
    if (!section) await addSection(config, 'outbound', set, `${kind}_${Date.now()}`)
    else {
      await setOptions(config, section['.name'], set)
      if (unset.length) await deleteOptions(config, section['.name'], unset)
    }
    await apply()
  } catch (error) {
    await revert(config).catch(() => {})
    throw error
  }
}

// UCI names an anonymous section by its position among all sections of the
// package and a hash of its type, cfg%02x%04x: deleting a section renames the
// anonymous ones after it, one position down for each deleted before it. Old
// name to new
export function shiftedNames(sections: UciSection[], deleted: UciSection[]) {
  const names = new Map<string, string>()
  for (const section of sections) {
    const match = /^cfg([0-9a-f]+)([0-9a-f]{4})$/.exec(section['.name'])
    const shift = deleted.filter((other) => other['.index'] < section['.index']).length
    if (section['.anonymous'] && shift && !deleted.includes(section) && match)
      names.set(section['.name'], `cfg${(parseInt(match[1], 16) - shift).toString(16).padStart(2, '0')}${match[2]}`)
  }
  return names
}

// sections deleted: what refers to an anonymous section after them takes its
// new name, here and in the device config, as it has once committed. Not
// applied
export async function deleteSections(profile: Profile, deleted: UciSection[], inbounds: UciSection[]) {
  const { config } = profile
  const names = shiftedNames(profile.sections, deleted)
  const rename = (ref: string) => names.get(ref) ?? ref

  for (const other of profile.sections) {
    if (deleted.includes(other)) continue
    const changed: Record<string, string | string[]> = {}
    for (const [key, value] of Object.entries(other)) {
      if (key.startsWith('.')) continue
      if (Array.isArray(value)) {
        if (value.some((ref) => names.has(ref))) changed[key] = value.map(rename)
      } else if (typeof value !== 'string') continue
      else if (names.has(value)) changed[key] = rename(value)
      else if (key === 'dial_fields' && dialDetour(value) && names.has(dialDetour(value)!))
        changed[key] = JSON.stringify({ ...JSON.parse(value), detour: rename(dialDetour(value)!) }, null, 2)
    }
    if (Object.keys(changed).length) await setOptions(config, other['.name'], changed)
  }
  if (profile.clashDetour && names.has(profile.clashDetour)) await setOptions('hako', 'clash_api', { external_ui_download_detour: rename(profile.clashDetour) })
  // the rule sets the routes of tun name
  for (const inbound of inbounds)
    for (const key of ['route_address_set', 'route_exclude_address_set'])
      if (list(inbound[key]).some((ref) => names.has(ref))) await setOptions('hako', inbound['.name'], { [key]: list(inbound[key]).map(rename) })

  for (const section of deleted) await deleteSection(config, section['.name'])
}

// an outbound deleted, and taken out of the groups that list it or default
// to it. What refers to an anonymous section after it then takes its new
// name, which it has once committed
export async function deleteOutbound(profile: Profile, section: UciSection) {
  const { config } = profile
  const names = shiftedNames(profile.sections, [section])
  const rename = (ref: string) => names.get(ref) ?? ref

  try {
    for (const other of profile.sections) {
      if (other === section) continue
      const changed: Record<string, string | string[]> = {}
      const removed: string[] = []

      for (const [key, value] of Object.entries(other)) {
        if (key.startsWith('.')) continue
        if (Array.isArray(value)) {
          const kept = (other['.type'] === 'outbound' && key === 'outbounds' ? value.filter((ref) => !refers(ref, section)) : value).map(rename)
          if (kept.join('\n') !== value.join('\n')) {
            if (kept.length) changed[key] = kept
            else removed.push(key)
          }
        } else if (typeof value !== 'string') continue
        else if (other['.type'] === 'outbound' && (key === 'outbounds' || key === 'default') && refers(value, section)) removed.push(key)
        else if (names.has(value)) changed[key] = rename(value)
        else if (key === 'dial_fields' && dialDetour(value) && names.has(dialDetour(value)!))
          changed[key] = JSON.stringify({ ...JSON.parse(value), detour: rename(dialDetour(value)!) }, null, 2)
      }

      if (Object.keys(changed).length) await setOptions(config, other['.name'], changed)
      if (removed.length) await deleteOptions(config, other['.name'], removed)
    }
    if (profile.clashDetour && names.has(profile.clashDetour))
      await setOptions('hako', 'clash_api', { external_ui_download_detour: rename(profile.clashDetour) })

    await deleteSection(config, section['.name'])
    await apply()
  } catch (error) {
    await revert(config).catch(() => {})
    await revert('hako').catch(() => {})
    throw error
  }
}

// a name not taken by any outbound, for a copy
export function copyName(profile: Profile, name: string) {
  const taken = new Set(profile.outbounds.map(label))
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? `${name} 副本` : `${name} 副本 ${i}`
    if (!taken.has(candidate)) return candidate
  }
}

// durations: sing-box takes them as 30s, 3m or 1h30m. A field shows a whole
// number of its unit, and takes one; another duration is kept as it is
const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export const DURATION = /^((\d+(ms|s|m|h|d))+)$/

function durationMs(value: string) {
  if (!DURATION.test(value)) return null
  let ms = 0
  for (const [, n, unit] of value.matchAll(/(\d+)(ms|s|m|h|d)/g)) ms += Number(n) * UNITS[unit]
  return ms
}

export function durationField(value: string | string[] | undefined, unit: 's' | 'm') {
  const text = typeof value === 'string' ? value : ''
  const ms = durationMs(text)
  return ms != null && ms % UNITS[unit] === 0 ? String(ms / UNITS[unit]) : text
}

export function durationValue(field: string, unit: 's' | 'm') {
  const value = field.trim()
  return /^\d+$/.test(value) ? `${value}${unit}` : value
}

export function isDuration(field: string) {
  const value = field.trim()
  return value === '' || /^\d+$/.test(value) || DURATION.test(value)
}
