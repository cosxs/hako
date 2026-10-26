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

  for (const deadline = Date.now() + APPLY_TIMEOUT; Date.now() < deadline; ) {
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
