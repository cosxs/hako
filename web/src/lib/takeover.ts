import { queryOptions } from '@tanstack/react-query'

import { label, type Profile } from '@/lib/policy'
import { applying, getConfig, writeSection, type UciSection } from '@/lib/uci'

// the takeover: settings of the device in the hako package (the tun, tproxy,
// dns and mixed inbounds, and the firewall of tproxy), and the DNS strategy
// of the profile in use, which follows the IPv6 takeover. FakeIP and the DNS
// servers are set under Core settings › DNS

// the IPv6 address of the tun for the IPv6 takeover, as in the examples of
// sing-box
const TUN_IPV6 = 'fdfe:dcba:9876::1/126'

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

export type TakeoverValues = {
  enabled: boolean
  mode: 'tun' | 'tproxy'
  ipv6: boolean
  dnsPort: string
  tunName: string
  tunAddress: string
  tunMtu: string
  tunBypassSets: string[]
  tunBypass4: string
  tunBypass6: string
  tproxyPort: string
  lan: string[]
  bypass4: string
  bypass6: string
  mixed: boolean
  mixedPort: string
  username: string
  password: string
}

// lists are edited one item a line
const lines = (values: string[]) => values.join('\n')
const unlines = (input: string) =>
  input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export function takeoverValues(profile: Profile, device: Device): TakeoverValues {
  const at = (name: string) => sectionNamed(device.sections, name)
  const tun = at('tun')
  const tproxy = at('tproxy')
  const firewall = at('firewall')
  const mixed = at('mixed')
  const tunExclude = list(tun?.route_exclude_address)
  return {
    enabled: tun?.enabled === '1' || tproxy?.enabled === '1',
    mode: tproxy?.enabled === '1' ? 'tproxy' : 'tun',
    ipv6: firewall?.ipv6 === '1',
    dnsPort: text(at('dns_in')?.listen_port),
    tunName: text(tun?.interface_name),
    tunAddress: lines(list(tun?.address)),
    tunMtu: text(tun?.mtu),
    tunBypassSets: list(tun?.route_exclude_address_set),
    tunBypass4: lines(tunExclude.filter((address) => !isV6(address))),
    tunBypass6: lines(tunExclude.filter(isV6)),
    tproxyPort: text(tproxy?.listen_port),
    lan: list(firewall?.interface),
    bypass4: lines(list(firewall?.bypass_address)),
    bypass6: lines(list(firewall?.bypass_address6)),
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

export const validCidr4Lines = (input: string) => unlines(input).every((line) => CIDR4.test(line))
export const validCidr6Lines = (input: string) => unlines(input).every((line) => CIDR6.test(line))
export const validCidrLines = (input: string) => unlines(input).every((line) => CIDR4.test(line) || CIDR6.test(line))
export const validPort = (input: string) => /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 65535

export async function saveTakeover(profile: Profile, device: Device, values: TakeoverValues) {
  const at = (name: string) => sectionNamed(device.sections, name)
  const on = (yes: boolean) => (yes ? '1' : '0')
  const tun = values.enabled && values.mode === 'tun'
  const tproxy = values.enabled && values.mode === 'tproxy'
  // the IPv6 takeover gives the tun an IPv6 address, which makes sing-box
  // route IPv6 as well; off, the tun keeps its IPv4 ones only
  const addresses = unlines(values.tunAddress)
  const address4 = addresses.filter((address) => !isV6(address))
  const address6 = addresses.filter(isV6)
  const tunAddress = values.ipv6 ? [...address4, ...(address6.length ? address6 : [TUN_IPV6])] : address4

  await applying(profile.config, async () => {
    await writeSection('hako', at('tun'), 'inbound', {
      enabled: on(tun),
      interface_name: values.tunName.trim(),
      address: tunAddress,
      mtu: values.tunMtu.trim(),
      route_exclude_address_set: values.tunBypassSets,
      route_exclude_address: [...unlines(values.tunBypass4), ...unlines(values.tunBypass6)],
    })
    await writeSection('hako', at('tproxy'), 'inbound', { enabled: on(tproxy), listen_port: values.tproxyPort.trim() })
    await writeSection('hako', at('dns_in'), 'inbound', { enabled: on(values.enabled), listen_port: values.dnsPort.trim() })
    await writeSection('hako', at('firewall'), 'hako', {
      ipv6: on(values.ipv6),
      interface: values.lan,
      bypass_address: unlines(values.bypass4),
      bypass_address6: unlines(values.bypass6),
    })
    if (at('mixed'))
      await writeSection('hako', at('mixed'), 'inbound', {
        enabled: on(values.mixed),
        listen_port: values.mixedPort.trim(),
        username: values.username.trim(),
        password: values.username.trim() ? values.password : '',
      })

    const dns = sectionNamed(profile.sections, 'dns')
    if (dns) await writeSection(profile.config, dns, 'dns', { strategy: values.ipv6 ? 'prefer_ipv4' : 'ipv4_only' })
  })
}
