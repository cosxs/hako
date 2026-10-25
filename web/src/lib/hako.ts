import { queryOptions } from '@tanstack/react-query'

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
