import { queryOptions } from '@tanstack/react-query'

import { call } from '@/lib/ubus'
import { apply, getSection, revert, setOptions } from '@/lib/uci'

// the logs of today, app.log of Hako and core.log of sing-box, through
// luci.hako, and how long the dated logs of the days before are kept

export type LogName = 'app' | 'core'

// what was written to a log from an offset on, the last 256 KiB at most; a
// log smaller than the offset was rotated or emptied, and is read from its
// start
export function readLog(name: LogName, offset: number) {
  return call<{ content?: string; size?: number; error?: string }>('luci.hako', 'log_read', { name, offset })
}

export type LogSettings = { autoClean: boolean; retentionDays: string }

export const logSettingsQuery = queryOptions({
  queryKey: ['hako', 'log-settings'],
  queryFn: async (): Promise<LogSettings> => {
    const logs = await getSection('hako', 'logs').catch(() => null)
    return {
      autoClean: logs?.auto_clean !== '0',
      retentionDays: typeof logs?.retention_days === 'string' ? logs.retention_days : '7',
    }
  },
})

export function validDays(input: string) {
  return /^\d+$/.test(input.trim()) && Number(input) >= 1 && Number(input) <= 365
}

export async function saveLogSettings(values: LogSettings) {
  try {
    await setOptions('hako', 'logs', { auto_clean: values.autoClean ? '1' : '0', retention_days: values.retentionDays.trim() })
    await apply()
  } catch (error) {
    await revert('hako').catch(() => {})
    throw error
  }
}
