import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { control, CORE_UPLOAD, coreInstall, coreInstallStatus, coreLatest, statusQuery } from '@/lib/hako'
import { upload } from '@/lib/ubus'
import { FieldRow, FieldSection } from '@/pages/rules/form'

// sing-box in the settings: its version and build tags, installing or
// updating it, and the service of its own package taken over by Hako
export function SingBoxSection() {
  const queryClient = useQueryClient()
  const { data } = useQuery(statusQuery)
  const [installing, setInstalling] = useState(false)

  const takeover = useMutation({
    mutationFn: () => control('takeover'),
    onSuccess: () => toast.success('已接管 sing-box 服务并启动'),
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hako'] }),
  })

  if (!data) return <Skeleton className="h-28 w-full rounded-lg" />
  const core = data.core

  return (
    <>
      <FieldSection title="sing-box">
        <FieldRow label="版本" wide>
          <div className="flex items-center justify-between gap-2">
            {core.installed ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[13px]">{core.version ?? '未知'}</span>
                {core.supported === false && <Badge variant="destructive-light">低于 {core.min_version.replace(/\.0$/, '')}</Badge>}
              </span>
            ) : (
              <span className="text-muted-foreground">未安装</span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setInstalling(true)}>
              {core.installed ? '更新…' : '安装…'}
            </Button>
          </div>
        </FieldRow>
        {!!core.tags?.length && (
          <FieldRow label="编译标签" wide>
            <span className="font-mono text-xs break-all">{core.tags.join(', ')}</span>
          </FieldRow>
        )}
        {core.service_active && (
          <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span>sing-box 软件包自带的服务正在运行或开机启动，Hako 不会启动。</span>
            <Button type="button" size="sm" disabled={takeover.isPending} onClick={() => takeover.mutate()}>
              {takeover.isPending && <Spinner />}由 Hako 接管
            </Button>
          </div>
        )}
      </FieldSection>
      {installing && <CoreInstallDialog minVersion={core.min_version} onOpenChange={setInstalling} />}
    </>
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
