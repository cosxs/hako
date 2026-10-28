import { queryOptions } from '@tanstack/react-query'

import { label, type Profile } from '@/lib/policy'
import { applying, getConfig, writeSection, type UciSection } from '@/lib/uci'

// the takeover: settings of the device in the hako package (the tun, tproxy,
// dns and mixed inbounds, and the firewall of tproxy). The DNS strategy,
// FakeIP and the DNS servers are those of each profile, under Core settings ›
// DNS

export type Device = {
  sections: UciSection[]
  // the interfaces of the network package the LAN may be made of
  interfaces: string[]
}

export const deviceQuery = queryOptions({
  queryKey: ['hako', 'device'],
  queryFn: async (): Promise<Device> => {
    const sections = await getConfig('hako')
    const network = await getConfig('network').catch(() => [])
    const interfaces = network.filter((section) => section['.type'] === 'interface' && section['.name'] !== 'loopback').map((section) => section['.name'])
    return { sections, interfaces }
  },
})

function text(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

function list(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : []
}

function sectionNamed(sections: UciSection[], name: string) {
  return sections.find((section) => section['.name'] === name) ?? null
}

const isV6 = (address: string) => address.includes(':')

// the takeover is on while sing-box runs, by the tun or the tproxy inbound,
// whichever is enabled, with the DNS inbound
export type TakeoverMode = 'tun' | 'tproxy'

export function takeoverMode(device: Device): TakeoverMode {
  return sectionNamed(device.sections, 'tproxy')?.enabled === '1' ? 'tproxy' : 'tun'
}

export function proxyPort(device: Device) {
  const mixed = sectionNamed(device.sections, 'mixed')
  return mixed ? { on: mixed.enabled === '1', port: text(mixed.listen_port), auth: !!text(mixed.username) } : null
}

// the settings of the takeover and of the proxy port, saved together
export type TakeoverValues = {
  mode: TakeoverMode
  ipv6: boolean
  tunName: string
  tunAddress: string[]
  tunMtu: string
  tunBypassSets: string[]
  tproxyPort: string
  lan: string[]
  // the addresses bypassed, by the tun and the tproxy firewall alike: read
  // from the one in use, saved to both
  bypass4: string[]
  bypass6: string[]
  mixed: boolean
  mixedPort: string
  username: string
  password: string
}

function bypassed(device: Device) {
  const at = (name: string) => sectionNamed(device.sections, name)
  if (takeoverMode(device) === 'tproxy') return { bypass4: list(at('firewall')?.bypass_address), bypass6: list(at('firewall')?.bypass_address6) }
  const exclude = list(at('tun')?.route_exclude_address)
  return { bypass4: exclude.filter((address) => !isV6(address)), bypass6: exclude.filter(isV6) }
}

export function takeoverValues(device: Device): TakeoverValues {
  const at = (name: string) => sectionNamed(device.sections, name)
  const tun = at('tun')
  const firewall = at('firewall')
  const mixed = at('mixed')
  return {
    mode: takeoverMode(device),
    ipv6: firewall?.ipv6 === '1',
    tunName: text(tun?.interface_name),
    tunAddress: list(tun?.address),
    tunMtu: text(tun?.mtu),
    tunBypassSets: list(tun?.route_exclude_address_set),
    tproxyPort: text(at('tproxy')?.listen_port),
    lan: list(firewall?.interface),
    ...bypassed(device),
    mixed: mixed?.enabled === '1',
    mixedPort: text(mixed?.listen_port),
    username: text(mixed?.username),
    password: text(mixed?.password),
  }
}

export function ruleSetChoices(profile: Profile): Record<string, string> {
  return Object.fromEntries(profile.sections.filter((section) => section['.type'] === 'rule_set').map((section) => [section['.name'], label(section)]))
}

const CIDR4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/([12]?\d|3[0-2])$/
const CIDR6 = /^[0-9a-f:]*:[0-9a-f:.]*\/(12[0-8]|1[01]\d|\d?\d)$/i

// the items of a list as saved: trimmed, the empty ones dropped
export const items = (values: string[]) => values.map((value) => value.trim()).filter(Boolean)

// an item of a list, which may be left empty
export const validCidr4 = (value: string) => !value.trim() || CIDR4.test(value.trim())
export const validCidr6 = (value: string) => !value.trim() || CIDR6.test(value.trim())
export const validCidr = (value: string) => !value.trim() || CIDR4.test(value.trim()) || CIDR6.test(value.trim())
export const validPort = (input: string) => /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 65535

export async function saveTakeover(device: Device, values: TakeoverValues) {
  const at = (name: string) => sectionNamed(device.sections, name)
  const on = (yes: boolean) => (yes ? '1' : '0')

  await applying('hako', async () => {
    await writeSection('hako', at('tun'), 'inbound', {
      enabled: on(values.mode === 'tun'),
      interface_name: values.tunName.trim(),
      address: items(values.tunAddress),
      mtu: values.tunMtu.trim(),
      route_exclude_address_set: values.tunBypassSets,
      route_exclude_address: [...items(values.bypass4), ...items(values.bypass6)],
    })
    await writeSection('hako', at('tproxy'), 'inbound', { enabled: on(values.mode === 'tproxy'), listen_port: values.tproxyPort.trim() })
    // the DNS inbound the firewall sends the queries to, on the port it has
    await writeSection('hako', at('dns_in'), 'inbound', { enabled: '1' })
    await writeSection('hako', at('firewall'), 'hako', {
      ipv6: on(values.ipv6),
      interface: values.lan,
      bypass_address: items(values.bypass4),
      bypass_address6: items(values.bypass6),
    })
    if (at('mixed'))
      await writeSection('hako', at('mixed'), 'inbound', {
        enabled: on(values.mixed),
        listen_port: values.mixedPort.trim(),
        username: values.username.trim(),
        password: values.username.trim() ? values.password : '',
      })
  })
}

// the proxy port, for devices set up by hand, turned on or off
export async function setProxyPort(device: Device, on: boolean) {
  const mixed = sectionNamed(device.sections, 'mixed')
  if (!mixed) throw new Error('没有代理端口')
  await applying('hako', () => writeSection('hako', mixed, 'inbound', { enabled: on ? '1' : '0' }))
}
