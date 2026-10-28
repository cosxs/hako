import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { control, CORE_UPLOAD, coreInstall, coreInstallStatus, coreLatest, statusQuery, type Status } from '@/lib/hako'
import { upload } from '@/lib/ubus'
import { ModeSwitch } from '@/pages/policy/mode-switch'

function takeoverText(takeover: Status['takeover']) {
  const parts = []
  if (takeover.tun) parts.push(`TUN（${takeover.tun}）`)
  if (takeover.tproxy) parts.push(`TProxy（${takeover.tproxy}）`)
  if (takeover.redirect) parts.push(`Redirect（${takeover.redirect}）`)
  if (takeover.dns) parts.push(`DNS 劫持（${[takeover.dns.tag, takeover.dns.port && `:${takeover.dns.port}`].filter(Boolean).join(' ')}）`)
  if (takeover.mixed) parts.push(`代理端口（${[takeover.mixed.tag, takeover.mixed.port && `:${takeover.mixed.port}`].filter(Boolean).join(' ')}）`)
  return parts.length ? parts.join(' · ') : '未接管'
}

// how long sing-box has run, in days, hours and minutes
function uptimeText(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return [days && `${days} 天`, (days || hours) && `${hours} 小时`, `${minutes} 分钟`].filter(Boolean).join(' ')
}

type Action = 'start' | 'stop' | 'reload' | 'enable' | 'takeover'

const DONE: Record<Action, string> = { start: '已启动', stop: '已停止', reload: '已重载', enable: '已启用并启动', takeover: '已接管 sing-box 服务并启动' }

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

// the state of Hako and sing-box: starting, stopping and reloading it, the
// outbound mode, and installing sing-box
export function ActivityPage() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery(statusQuery)
  const [installing, setInstalling] = useState(false)
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

  if (!data)
    return (
      <div className="flex w-full max-w-[1120px] flex-col gap-6">
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    )

  const core = data.core
  const usable = core.installed && core.supported !== false
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
    <div className="grid w-full max-w-[1120px] items-start gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>运行状态</CardTitle>
          <CardDescription>每 5 秒刷新</CardDescription>
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
              { label: '配置', value: data.profile_title },
              { label: '接管', value: takeoverText(data.takeover) },
              {
                label: '出站模式',
                value: data.clash_api ? data.clash_api.modes.length > 1 ? <ModeSwitch className="flex" /> : data.clash_api.mode : '-',
              },
              { label: '插件版本', value: <span className="font-mono">{data.version ?? '-'}</span> },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>sing-box</CardTitle>
          <CardDescription>需要 {core.min_version.replace(/\.0$/, '')} 或更高版本</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setInstalling(true)}>
              {core.installed ? '更新…' : '安装…'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Rows
            rows={[
              {
                label: '版本',
                value: core.installed ? (
                  <span className="flex items-center gap-2">
                    <span className="font-mono">{core.version ?? '未知'}</span>
                    {core.supported === false && <Badge variant="destructive-light">版本过低</Badge>}
                  </span>
                ) : (
                  '未安装'
                ),
              },
              ...(core.tags?.length ? [{ label: '编译标签', value: <span className="font-mono text-xs break-all">{core.tags.join(', ')}</span> }] : []),
            ]}
          />
          {core.service_active && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
              <span>sing-box 软件包自带的服务正在运行或开机启动，Hako 不会启动。</span>
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate('takeover')}>
                {busy('takeover') && <Spinner />}由 Hako 接管
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {installing && <CoreInstallDialog minVersion={core.min_version} onOpenChange={setInstalling} />}
    </div>
  )
}

// installing sing-box: the latest release from GitHub, or a package
// uploaded, then the output of the installation until it ends
function CoreInstallDialog({ minVersion, onOpenChange }: { minVersion: string; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const latest = useQuery({ queryKey: ['hako', 'core-latest'], queryFn: coreLatest, retry: false, staleTime: 60_000 })
  const [started, setStarted] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const start = useMutation({
    mutationFn: async (source: { github: true } | { upload: File }) => {
      if ('upload' in source) {
        await upload(CORE_UPLOAD, source.upload)
        await coreInstall('upload')
      } else await coreInstall('github')
    },
    onSuccess: () => setStarted(true),
    onError: (error: Error) => toast.error(`无法开始安装：${error.message}`),
  })

  const status = useQuery({
    queryKey: ['hako', 'core-install-status'],
    queryFn: coreInstallStatus,
    enabled: started,
    refetchInterval: (query) => (query.state.data && !query.state.data.running ? false : 1000),
  })
  const done = started && status.data && !status.data.running && status.data.success != null
  const output = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }, [status.data?.log])

  useEffect(() => {
    if (!done) return
    if (status.data?.success) toast.success('sing-box 已安装')
    else toast.error('安装失败，请查看输出')
    queryClient.invalidateQueries({ queryKey: ['hako', 'status'] })
  }, [done, status.data?.success, queryClient])

  const info = latest.data
  const size = info?.size ? `${(info.size / 1024 / 1024).toFixed(1)} MB` : null
  const free = info?.free_space != null ? `${(info.free_space / 1024 / 1024).toFixed(1)} MB` : null

  return (
    <Dialog open onOpenChange={(open) => (!started || done ? onOpenChange(open) : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{started ? '正在安装 sing-box' : '安装 sing-box'}</DialogTitle>
          <DialogDescription>
            需要 {minVersion.replace(/\.0$/, '')} 或更高版本，官方构建约占 90 MB 存储空间{free && `，剩余 ${free}`}。
          </DialogDescription>
        </DialogHeader>

        {!started ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3.5 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">GitHub 最新版本</span>
                <span className="text-muted-foreground">
                  {latest.isPending
                    ? '正在查询…'
                    : info?.error
                      ? info.error
                      : latest.error
                        ? latest.error.message
                        : `${info?.version}，${info?.arch}${size ? `，下载 ${size}` : ''}`}
                </span>
              </div>
              <Button size="sm" disabled={!info?.version || start.isPending} onClick={() => start.mutate({ github: true })}>
                {start.isPending && start.variables && 'github' in start.variables && <Spinner />}
                安装
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3.5 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">上传 apk 软件包</span>
                <span className="break-all text-muted-foreground">sing-box 发布页的 sing-box_*_openwrt_{info?.arch ?? '…'}.apk</span>
              </div>
              <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => file.current?.click()}>
                {start.isPending && start.variables && 'upload' in start.variables && <Spinner />}
                选择文件…
              </Button>
              <input
                ref={file}
                type="file"
                accept=".apk"
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0]
                  event.target.value = ''
                  if (chosen) start.mutate({ upload: chosen })
                }}
              />
            </div>
          </div>
        ) : (
          <pre
            ref={output}
            className="max-h-72 min-h-32 overflow-auto rounded-lg border bg-muted/30 px-3.5 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap"
          >
            {status.data?.log || '正在开始…'}
          </pre>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={started && !done} />}>{done ? '完成' : '取消'}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
