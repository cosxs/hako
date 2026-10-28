import { queryOptions } from '@tanstack/react-query'

import { toast } from 'sonner'

import { call } from '@/lib/ubus'

// the rpcd plugin of Hako, luci.hako

export type CoreInfo = {
  installed: boolean
  version?: string
  min_version: string
  supported?: boolean
  tags?: string[]
  service_active?: boolean
}

export type Status = {
  enabled: boolean
  running: boolean
  uptime: number | null
  profile: string
  profile_title: string
  version: string | null
  core: CoreInfo
  // the tags of the inbounds that take over traffic
  takeover: {
    tun: string | null
    tproxy: string | null
    redirect: string | null
    dns: { tag: string; port?: number } | null
    mixed: { tag: string; port?: number } | null
  }
  clash_api: { mode: string; modes: string[] } | null
}

export const statusQuery = queryOptions({
  queryKey: ['hako', 'status'],
  queryFn: () => call<Status>('luci.hako', 'status'),
  refetchInterval: 5000,
})

// the outbound modes sing-box offers by default, by their lowercase names
const MODE_NAMES: Record<string, string> = {
  rule: '规则判定',
  global: '全局代理',
  direct: '直接连接',
}

export function modeName(mode: string) {
  return MODE_NAMES[mode.toLowerCase()] ?? mode
}

// switches the outbound mode: kept in main.mode, and a running service is
// reloaded, which sets it on sing-box
export async function setMode(mode: string) {
  const result = await call<{ result: boolean; error?: string }>('luci.hako', 'mode_set', { mode })
  if (!result.result) throw new Error(result.error === 'no_clash_api' ? '没有启用 Clash API，无法切换出站模式' : `无法切换到 ${modeName(mode)}`)
}

// whether sing-box runs what the settings give, as luci.hako reports it
type Applied = { running: boolean; current?: boolean; restarting?: boolean; api?: boolean }

// how a change took effect: sing-box runs it, nothing runs to take it, or
// it did not run it in time
export type Effect = 'applied' | 'stopped' | 'timeout'

const APPLY_TIMEOUT = 20_000

// makes a change of the settings, then waits for sing-box to run it: the
// reload it triggers generates the config, and a new one restarts sing-box
export async function untilApplied<T>(change: () => Promise<T>): Promise<{ result: T; effect: Effect }> {
  const result = await change()

  for (const deadline = Date.now() + APPLY_TIMEOUT; Date.now() < deadline;) {
    const now = await call<Applied>('luci.hako', 'applied').catch(() => null)
    if (now && !now.running) return { result, effect: 'stopped' }
    if (now?.current && !now.restarting && now.api) return { result, effect: 'applied' }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return { result, effect: 'timeout' }
}

// the toast of a change by how it took effect
export function effectToast(done: string, effect: Effect) {
  if (effect === 'applied') toast.success(`${done}，已生效`)
  else if (effect === 'stopped') toast.success(`${done}，服务未运行，启动后生效`)
  else toast.warning(`${done}，但 sing-box 还没有运行新的配置，请查看日志`)
}

// starts, stops, restarts or reloads the service; enable turns it on first,
// and takeover stops and disables the service of the sing-box package too
export async function control(action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'takeover') {
  const result = await call<{ result: boolean; error?: string }>('luci.hako', 'control', { action })
  if (!result.result) throw new Error(result.error ?? '操作失败，请查看日志')
}

// the latest release of sing-box on GitHub for this router
export type CoreLatest = { version?: string; arch?: string; size?: number; free_space?: number; error?: string }

export function coreLatest() {
  return call<CoreLatest>('luci.hako', 'core_latest')
}

// where an uploaded package goes, which the ACL lets the app write
export const CORE_UPLOAD = '/tmp/hako-core-upload.apk'

// installs sing-box in the background from GitHub or the uploaded package
export async function coreInstall(source: 'github' | 'upload') {
  const result = await call<{ result: boolean; error?: string }>('luci.hako', 'core_install', { source })
  if (!result.result) throw new Error(result.error === 'busy' ? '正在安装，请稍候' : (result.error ?? '无法开始安装'))
}

export type CoreInstallStatus = { running: boolean; success: boolean | null; log: string }

export function coreInstallStatus() {
  return call<CoreInstallStatus>('luci.hako', 'core_install_status')
}

// the WAN, the connections of sing-box and the bytes it moved since it
// started, read every few seconds for the activity page
export type Overview = {
  network: { interface: string; proto: string; device?: string; address?: string; gateway?: string | null; uptime?: number } | null
  dhcp_devices: number
  connections: { count: number; devices: number; router: number; upload_total: number; download_total: number } | null
}

export const overviewQuery = queryOptions({
  queryKey: ['hako', 'overview'],
  queryFn: () => call<Overview>('luci.hako', 'overview'),
  refetchInterval: 2000,
})

// the latency to the gateway, to the first DNS server of the WAN, and of the
// node the default outbound uses now, in milliseconds
export type Latency = {
  gateway: { address: string; ms: number | null } | null
  dns: { server: string; ms: number | null } | null
  proxy: { name: string; type: string; ms: number | null } | null
}

export const latencyQuery = queryOptions({
  queryKey: ['hako', 'latency'],
  queryFn: () => call<Latency>('luci.hako', 'latency'),
  refetchInterval: 60_000,
  staleTime: 30_000,
})

export const externalIpQuery = queryOptions({
  queryKey: ['hako', 'external-ip'],
  queryFn: () => call<{ address?: string; source?: string; error?: string }>('luci.hako', 'external_ip'),
  staleTime: 300_000,
  refetchInterval: 300_000,
})

// the latest lines of the plugin log, newest first
export const eventsQuery = queryOptions({
  queryKey: ['hako', 'events'],
  queryFn: async () => (await call<{ events?: string[] }>('luci.hako', 'events')).events ?? [],
  refetchInterval: 10_000,
})
