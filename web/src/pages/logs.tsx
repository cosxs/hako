import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { logSettingsQuery, readLog, saveLogSettings, validDays, type LogName, type LogSettings } from '@/lib/logs'
import { SaveButton, UnitInput } from '@/pages/core/fields'
import { FieldRow, FieldSection, SwitchRow } from '@/pages/rules/form'

const LOGS: Record<LogName, string> = { app: '插件日志', core: '内核日志' }
const REFRESH = 3000

// the logs: how long they are kept, and today's plugin and core logs, each
// refreshed every few seconds
export function LogsPage() {
  const [tab, setTab] = useState<LogName>('app')

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-6">
      <LogSettingsForm />
      <section className="flex flex-col gap-3">
        <Tabs value={tab} onValueChange={(next) => setTab(next as LogName)}>
          <TabsList>
            {(Object.keys(LOGS) as LogName[]).map((name) => (
              <TabsTrigger key={name} value={name}>
                {LOGS[name]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <LogView key={tab} name={tab} />
      </section>
    </div>
  )
}

function LogSettingsForm() {
  const { data } = useQuery(logSettingsQuery)
  if (!data) return <Skeleton className="h-28 w-full rounded-lg xl:w-[calc(50%-12px)]" />
  return <LogSettingsFields key={JSON.stringify(data)} values={data} />
}

function LogSettingsFields({ values }: { values: LogSettings }) {
  const queryClient = useQueryClient()
  const [autoClean, setAutoClean] = useState(values.autoClean)
  const [days, setDays] = useState(values.retentionDays)
  const [touched, setTouched] = useState(false)
  const invalid = autoClean && !validDays(days)

  const save = useMutation({
    mutationFn: () => saveLogSettings({ autoClean, retentionDays: autoClean ? days : values.retentionDays }),
    onSuccess: () => {
      toast.success('已保存日志设置')
      queryClient.invalidateQueries({ queryKey: ['hako', 'log-settings'] })
    },
    onError: (error: Error) => toast.error(`保存失败：${error.message}`),
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (!invalid) save.mutate()
      }}
    >
      {/* one card, half the width as in the core settings */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <FieldSection title="日志设置">
          <SwitchRow id="logs-auto-clean" label="自动清理" checked={autoClean} onCheckedChange={setAutoClean} />
          {autoClean && (
            <FieldRow label="保留天数" htmlFor="logs-days" wide>
              <UnitInput id="logs-days" value={days} unit="天" invalid={touched && invalid} onChange={setDays} />
            </FieldRow>
          )}
        </FieldSection>
      </div>
      <SaveButton pending={save.isPending} />
    </form>
  )
}

// a log of today, read again from where it was cleared every few seconds;
// clearing only empties the view, the file is kept
function LogView({ name }: { name: LogName }) {
  const [offset, setOffset] = useState(0)
  const { data, error } = useQuery({
    queryKey: ['hako', 'log', name, offset],
    queryFn: () => readLog(name, offset),
    refetchInterval: REFRESH,
  })
  const output = useRef<HTMLPreElement>(null)
  const size = data?.size ?? 0
  const content = data?.content ?? ''

  // follows the end of the log unless scrolled up to read
  const following = useRef(true)
  useEffect(() => {
    const node = output.current
    if (node && following.current) node.scrollTop = node.scrollHeight
  }, [content])

  const failure = error?.message ?? data?.error
  useEffect(() => {
    if (failure) toast.error(`读取日志失败：${failure}`, { id: 'log-error' })
  }, [failure])

  return (
    <div className="flex flex-col gap-2">
      <pre
        ref={output}
        className="h-[min(32rem,60dvh)] overflow-auto rounded-xl border bg-muted/30 px-3.5 py-2.5 font-mono text-xs leading-5 whitespace-pre"
        onScroll={(event) => {
          const node = event.currentTarget
          following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24
        }}
      >
        {content || <span className="text-muted-foreground">没有新的日志</span>}
      </pre>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>只显示当天的日志，每 3 秒刷新</span>
        <Button type="button" variant="outline" size="sm" title="只清空这里显示的内容，日志文件不删除" onClick={() => setOffset(size)}>
          清空
        </Button>
      </div>
    </div>
  )
}
