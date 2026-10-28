import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCwIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { control, eventsQuery, externalIpQuery, latencyQuery, modeName, overviewQuery, statusQuery, type Overview } from '@/lib/hako'
import { deviceQuery, setProxyPort } from '@/lib/takeover'
import { cn } from '@/lib/utils'
import { ModeSwitch } from '@/pages/policy/mode-switch'

// how long sing-box has run, in days, hours and minutes
function uptimeText(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days && `${days} 天`, (days || hours) && `${hours} 小时`, `${minutes} 分钟`].filter(Boolean).join(' ')
}

// a rate in bytes a second as a number and its unit
function rate(bytes: number): [string, string] {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return [value >= 100 || unit === 0 ? Math.round(value).toString() : value.toFixed(1), units[unit]]
}

const PROTOCOLS: Record<string, string> = { pppoe: 'PPPoE', dhcp: 'DHCP', dhcpv6: 'DHCPv6', static: '静态地址' }

type Action = 'start' | 'stop' | 'reload' | 'enable'

const DONE: Record<Action, string> = { start: '已启动', stop: '已停止', reload: '已重载', enable: '已启用并启动' }

function Rows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-8 gap-y-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// a figure: a small caption over a large value and its unit
function Figure({ label, value, unit, small }: { label: ReactNode; value: ReactNode; unit?: string; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn('truncate font-semibold tabular-nums', small ? 'text-xl' : 'text-4xl tracking-tight')}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </span>
    </div>
  )
}

function ms(value: number | null | undefined) {
  return value == null ? '-' : String(value)
}

// the rates of the last minutes, read from the bytes sing-box moved since it
// started, sampled each time the overview comes in
type Sample = { up: number; down: number }
const SAMPLES = 60

function useRates(overview: Overview | undefined) {
  const last = useRef<{ up: number; down: number; at: number } | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const connections = overview?.connections

  useEffect(() => {
    if (!connections) {
      last.current = null
      return
    }
    const now = { up: connections.upload_total, down: connections.download_total, at: Date.now() }
    const before = last.current
    last.current = now
    // a restart of sing-box starts its counts again
    if (!before || now.up < before.up || now.down < before.down) return
    const seconds = Math.max((now.at - before.at) / 1000, 0.5)
    setSamples((list) => [...list, { up: (now.up - before.up) / seconds, down: (now.down - before.down) / seconds }].slice(-SAMPLES))
  }, [connections])

  return samples
}

// a line of the rates of the last minutes, filled below
function Sparkline({ values, className }: { values: number[]; className: string }) {
  const max = Math.max(...values, 1)
  const width = 200
  const height = 64
  // the newest on the right edge, older ones to the left of it
  const step = width / (SAMPLES - 1)
  const points = values.map((value, index) => [width - (values.length - 1 - index) * step, height - (value / max) * (height - 4) - 2])
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn('h-16 w-full', className)} aria-hidden="true">
      {points.length > 1 && (
        <>
          <polygon points={`${line} ${width},${height} ${points[0][0].toFixed(1)},${height}`} className="fill-current opacity-15" />
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  )
}

function SpeedCard({ title, values, className }: { title: string; values: number[]; className: string }) {
  const [value, unit] = rate(values.length ? values[values.length - 1] : 0)
  const [peak, peakUnit] = rate(Math.max(...values, 0))
  return (
    <Card className="gap-2 overflow-hidden pb-0">
      <CardContent className="flex items-start justify-between gap-2">
        <Figure label={title} value={value} unit={unit} />
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {peak} {peakUnit}
        </span>
      </CardContent>
      <Sparkline values={values} className={className} />
    </Card>
  )
}

// a switch of the top bar: a dot, green when on, and its name
function ToggleChip({ label, on, busy, onToggle }: { label: string; on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" size="sm" className="rounded-full" disabled={busy} aria-pressed={on} onClick={onToggle}>
      {busy ? <Spinner /> : <span className={cn('size-2 rounded-full', on ? 'bg-green-500' : 'bg-muted-foreground/40')} />}
      {label}
    </Button>
  )
}

// the latest events of the plugin log, the newest one shown
function Events() {
  const { data } = useQuery(eventsQuery)
  const latest = data?.[0]
  const text = (line: string) => line.replace(/^\d{4}-\d{2}-\d{2} /, '')
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="max-w-full min-w-0 rounded-full bg-muted text-muted-foreground" />}>
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        <span className="truncate">{latest ? text(latest) : '无事件'}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))]">
        {data?.length ? (
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto font-mono text-xs">
            {data.map((line, index) => (
              <li key={index} className="break-all">
                {text(line)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">今天还没有事件</p>
        )}
      </PopoverContent>
    </Popover>
  )
}

// the state of Hako and sing-box at a glance, as the activity page of Surge:
// the network, the latency, the rates and the connections; starting,
// stopping and reloading it, and the outbound mode
export function ActivityPage() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery(statusQuery)
  const overview = useQuery(overviewQuery).data
  const latency = useQuery(latencyQuery)
  const external = useQuery(externalIpQuery).data
  const device = useQuery(deviceQuery).data
  const samples = useRates(overview)
  const failure = error?.message

  // once for each failure, not again at each refetch failing as well
  useEffect(() => {
    if (failure) toast.error(`读取状态失败：${failure}`, { id: 'status-error' })
  }, [failure])

  const act = useMutation({
    mutationFn: (action: Action) => control(action),
    onSuccess: (_, action) => toast.success(DONE[action]),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hako'] }),
  })
  const busy = (action: Action) => act.isPending && act.variables === action

  const toggle = useMutation({
    mutationFn: (on: boolean) => setProxyPort(device!, on),
    onSuccess: (_, on) => toast.success(`代理端口已${on ? '打开' : '关闭'}`),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hako'] }),
  })

  if (!data)
    return (
      <div className="flex w-full max-w-[1120px] flex-col gap-6">
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )

  const core = data.core
  const usable = core.installed && core.supported !== false
  // what keeps sing-box from starting, set right in the settings
  const coreProblem = !core.installed ? '未安装' : core.supported === false ? '版本过低' : core.service_active ? '自带的服务在用' : null
  const section = (name: string) => device?.sections.find((item) => item['.name'] === name)
  const mixedOn = section('mixed')?.enabled === '1'
  const net = overview?.network
  const connections = overview?.connections
  const proxy = latency.data?.proxy

  const controls = !data.enabled ? (
    <Button size="sm" disabled={act.isPending || !usable} onClick={() => act.mutate('enable')}>
      {busy('enable') && <Spinner />}
      启用并启动
    </Button>
  ) : data.running ? (
    <>
      <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('reload')}>
        {busy('reload') && <Spinner />}
        重载
      </Button>
      <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate('stop')}>
        {busy('stop') && <Spinner />}
        停止
      </Button>
    </>
  ) : (
    <Button size="sm" disabled={act.isPending || !usable} onClick={() => act.mutate('start')}>
      {busy('start') && <Spinner />}
      启动
    </Button>
  )

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Events />
        </div>
        {section('mixed') && <ToggleChip label="代理端口" on={mixedOn} busy={toggle.isPending} onToggle={() => toggle.mutate(!mixedOn)} />}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Figure small label="网络" value={net ? (PROTOCOLS[net.proto] ?? net.proto) : '-'} />
        <Figure small label="配置" value={data.profile_title} />
        <Figure small label="出站模式" value={data.clash_api ? modeName(data.clash_api.mode) : '-'} />
        <Figure small label="外部 IP" value={external?.address ?? '-'} />
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              延迟
              <Button variant="ghost" size="icon-xs" aria-label="重新测量延迟" disabled={latency.isFetching} onClick={() => latency.refetch()}>
                <RefreshCwIcon className={cn(latency.isFetching && 'animate-spin')} />
              </Button>
            </CardDescription>
            <CardTitle>
              <Figure label={proxy ? proxy.name : '代理'} value={ms(proxy?.ms)} unit="ms" />
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-auto grid grid-cols-2 gap-4">
            <Figure small label="路由" value={ms(latency.data?.gateway?.ms)} unit="ms" />
            <Figure small label="DNS" value={ms(latency.data?.dns?.ms)} unit="ms" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-6">
          <SpeedCard title="上传" values={samples.map((sample) => sample.up)} className="text-chart-4" />
          <SpeedCard title="下载" values={samples.map((sample) => sample.down)} className="text-chart-2" />
        </div>

        <Card>
          <CardHeader>
            <CardDescription>活动连接</CardDescription>
            <CardTitle>
              <Figure label="" value={connections ? connections.count : '-'} />
            </CardTitle>
          </CardHeader>
          <CardContent className="mt-auto grid grid-cols-3 gap-4">
            <Figure small label="设备" value={connections ? connections.devices : '-'} />
            <Figure small label="路由器自身" value={connections ? connections.router : '-'} />
            <Figure small label="DHCP 设备" value={overview ? overview.dhcp_devices : '-'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>运行状态</CardTitle>
            <CardAction className="flex gap-2">{controls}</CardAction>
          </CardHeader>
          <CardContent>
            <Rows
              rows={[
                {
                  label: '状态',
                  value: data.running ? (
                    <Badge variant="success-light">运行中</Badge>
                  ) : data.enabled ? (
                    <Badge variant="outline">未运行</Badge>
                  ) : (
                    <Badge variant="outline">未启用</Badge>
                  ),
                },
                { label: '运行时长', value: data.running && data.uptime != null ? uptimeText(data.uptime) : '-' },
                {
                  label: '出站模式',
                  value: data.clash_api ? (
                    data.clash_api.modes.length > 1 ? (
                      <ModeSwitch className="flex min-w-0" compact />
                    ) : (
                      modeName(data.clash_api.mode)
                    )
                  ) : (
                    '-'
                  ),
                },
                { label: 'WAN', value: net ? <span className="font-mono">{[net.interface, net.device, net.address].filter(Boolean).join(' · ')}</span> : '-' },
                { label: '插件版本', value: <span className="font-mono">{data.version ?? '-'}</span> },
                ...(coreProblem
                  ? [
                      {
                        label: 'sing-box',
                        value: (
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge variant="destructive-light">{coreProblem}</Badge>
                            <Link to="/settings" className="text-primary hover:underline">
                              前往设置
                            </Link>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
