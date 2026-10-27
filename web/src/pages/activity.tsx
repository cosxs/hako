import { useQuery } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/reui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { modeName, statusQuery, type Status } from '@/lib/hako'

function takeoverText(takeover: Status['takeover']) {
  const parts = []
  if (takeover.tun) parts.push(`TUN（${takeover.tun}）`)
  if (takeover.tproxy) parts.push(`TProxy（${takeover.tproxy}）`)
  if (takeover.redirect) parts.push(`Redirect（${takeover.redirect}）`)
  if (takeover.dns) parts.push(`DNS 劫持（${[takeover.dns.tag, takeover.dns.port && `:${takeover.dns.port}`].filter(Boolean).join(' ')}）`)
  if (takeover.mixed) parts.push(`代理端口（${[takeover.mixed.tag, takeover.mixed.port && `:${takeover.mixed.port}`].filter(Boolean).join(' ')}）`)
  return parts.length ? parts.join(' · ') : '未接管'
}

export function ActivityPage() {
  const { data, error, isPending } = useQuery(statusQuery)
  const failure = error?.message

  // once for each failure, not again at each refetch failing as well
  useEffect(() => {
    if (failure) toast.error(`读取状态失败：${failure}`, { id: 'status-error' })
  }, [failure])

  const rows: { label: string; value: ReactNode }[] = data
    ? [
        { label: '状态', value: data.running ? <Badge variant="success-light">运行中</Badge> : <Badge variant="outline">未运行</Badge> },
        { label: '配置', value: data.profile_title },
        { label: '接管', value: takeoverText(data.takeover) },
        { label: '出站模式', value: data.clash_api ? modeName(data.clash_api.mode) : '-' },
        { label: '内核版本', value: data.core.installed ? <span className="font-mono">{data.core.version}</span> : '未安装' },
        { label: '插件版本', value: <span className="font-mono">{data.version ?? '-'}</span> },
      ]
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>运行状态</CardTitle>
        <CardDescription>每 5 秒刷新</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-5 w-64" />
            ))}
          </div>
        )}
        {data && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-3 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
