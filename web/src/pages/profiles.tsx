import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  createProfile,
  deleteProfile,
  exportProfile,
  importedTitle,
  importProfile,
  profilesQuery,
  renameProfile,
  summaryQuery,
  switchProfile,
  viewProfile,
  type ProfileEntry,
  type ProfileSummary,
} from '@/lib/profiles'
import { StackedField } from '@/pages/rules/form'

// what a profile has, as Surge describes its profiles
function describe(summary?: ProfileSummary) {
  if (!summary) return ''
  return [`${summary.rules} 条规则`, `${summary.nodes} 个节点`, summary.subscriptions && `${summary.subscriptions} 个订阅`].filter(Boolean).join('，')
}

// a title asked for: a new profile's, another one, or an imported one's
type Naming = { kind: 'create' } | { kind: 'rename'; profile: ProfileEntry } | { kind: 'import'; content: string; title: string }

// the profiles as Surge lists them: the one in use checked, a click selects
// one, which the buttons below act on, and Apply switches to it
export function ProfilesPage() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery(profilesQuery)
  const summaries = useQuery({ ...summaryQuery(data?.profiles.map((profile) => profile.name) ?? []), enabled: !!data }).data
  const [selected, setSelected] = useState<string | null>(null)
  const [naming, setNaming] = useState<Naming | null>(null)
  const [viewing, setViewing] = useState<ProfileEntry | null>(null)
  const [deleting, setDeleting] = useState<ProfileEntry | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const failure = error?.message
  useEffect(() => {
    if (failure) toast.error(`读取配置文件失败：${failure}`, { id: 'profiles-error' })
  }, [failure])

  const current = data?.profile
  // the one in use is selected until another is
  const chosen = data?.profiles.find((profile) => profile.name === (selected ?? current)) ?? null

  const use = useMutation({
    mutationFn: (profile: ProfileEntry) => switchProfile(profile.name),
    onSuccess: (reloaded, profile) => {
      toast.success(reloaded ? `已切换到 ${profile.title}，已生效` : `已切换到 ${profile.title}，服务未运行，启动后生效`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error, profile) => toast.error(`无法切换到 ${profile.title}：${error.message}`),
  })

  const remove = useMutation({
    mutationFn: (profile: ProfileEntry) => deleteProfile(profile.name),
    onSuccess: (_, profile) => {
      toast.success(`已删除 ${profile.title}`)
      setDeleting(null)
      setSelected(null)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error, profile) => toast.error(`无法删除 ${profile.title}：${error.message}`),
  })

  const download = useMutation({
    mutationFn: (profile: ProfileEntry) => exportProfile(profile.name),
    onError: (error: Error, profile) => toast.error(`无法导出 ${profile.title}：${error.message}`),
  })

  // a file chosen to import, named by the title it has
  const pick = async (chosenFile: File) => {
    const content = await chosenFile.text()
    setNaming({ kind: 'import', content, title: importedTitle(content, chosenFile.name) })
  }

  if (!data)
    return (
      <div className="flex w-full max-w-[720px] flex-col gap-3">
        <Skeleton className="h-60 w-full rounded-xl" />
      </div>
    )

  const busy = use.isPending || remove.isPending

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-4">
      <div className="flex flex-col overflow-hidden rounded-xl border shadow-xs">
        <Table className="table-fixed select-none">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead className="w-2/5">名称</TableHead>
              <TableHead className="pr-4">描述</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.profiles.map((profile) => (
              <TableRow
                key={profile.name}
                tabIndex={0}
                data-state={chosen?.name === profile.name ? 'selected' : undefined}
                className="cursor-default"
                onClick={() => setSelected(profile.name)}
              >
                <TableCell className="text-center">{profile.name === current && <CheckIcon className="mx-auto size-4" aria-label="使用中" />}</TableCell>
                <TableCell className="truncate">{profile.title}</TableCell>
                <TableCell className="truncate pr-4 text-muted-foreground">{describe(summaries?.[profile.name])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center gap-1 border-t bg-muted/50 px-3 py-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="新建配置" disabled={busy} onClick={() => setNaming({ kind: 'create' })}>
            <PlusIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="删除选中的配置"
            disabled={busy || !chosen || chosen.name === current}
            onClick={() => chosen && setDeleting(chosen)}
          >
            <MinusIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-2"
            disabled={!chosen}
            onClick={() => chosen && setNaming({ kind: 'rename', profile: chosen })}
          >
            重命名…
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!chosen} onClick={() => chosen && setViewing(chosen)}>
            查看…
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!chosen || download.isPending} onClick={() => chosen && download.mutate(chosen)}>
            导出…
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()}>
            导入…
          </Button>
          <input
            ref={file}
            type="file"
            accept=".conf,text/plain"
            className="hidden"
            onChange={(event) => {
              const chosenFile = event.target.files?.[0]
              event.target.value = ''
              if (chosenFile) pick(chosenFile)
            }}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={busy || !chosen || chosen.name === current} onClick={() => chosen && use.mutate(chosen)}>
          {use.isPending && <Spinner />}
          应用
        </Button>
      </div>

      {naming && (
        <NameDialog
          naming={naming}
          titles={data.profiles.filter((profile) => naming.kind !== 'rename' || profile.name !== naming.profile.name).map((profile) => profile.title)}
          onDone={(name) => {
            if (name) setSelected(name)
            setNaming(null)
          }}
        />
      )}
      {viewing && <ViewDialog profile={viewing} onOpenChange={(open) => !open && setViewing(null)} />}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {deleting?.title}？</AlertDialogTitle>
            <AlertDialogDescription>这份配置和它的订阅下载的节点都会删除，不能恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              {remove.isPending && <Spinner />}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const NAMING = {
  create: { heading: '新建配置', action: '新建', done: '已新建' },
  rename: { heading: '重命名配置', action: '重命名', done: '已重命名为' },
  import: { heading: '导入配置', action: '导入', done: '已导入' },
}

// the title of a new profile, another title of one, or the title of one
// imported; done with the name of the profile, or none when cancelled
function NameDialog({ naming, titles, onDone }: { naming: Naming; titles: string[]; onDone: (name?: string) => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(naming.kind === 'rename' ? naming.profile.title : naming.kind === 'import' ? naming.title : '')
  const [touched, setTouched] = useState(false)
  const invalid = !title.trim() || titles.includes(title.trim())
  const text = NAMING[naming.kind]

  const save = useMutation({
    mutationFn: async () => {
      if (naming.kind === 'create') return createProfile(title)
      if (naming.kind === 'import') return importProfile(naming.content, title)
      await renameProfile(naming.profile.name, title)
      return naming.profile.name
    },
    onSuccess: (name) => {
      toast.success(`${text.done} ${title.trim()}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onDone(name)
    },
    onError: (error: Error) => toast.error(`无法${text.action}配置：${error.message}`),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-sm">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (!invalid) save.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>{text.heading}</DialogTitle>
            <DialogDescription className="sr-only">配置名</DialogDescription>
          </DialogHeader>
          <StackedField label="配置名" htmlFor="profile-title">
            <Input id="profile-title" autoFocus value={title} aria-invalid={touched && invalid} onChange={(event) => setTitle(event.target.value)} />
          </StackedField>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {text.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// the config a profile makes, read-only, and what the generator skipped
function ViewDialog({ profile, onOpenChange }: { profile: ProfileEntry; onOpenChange: (open: boolean) => void }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['hako', 'profile-view', profile.name],
    queryFn: () => viewProfile(profile.name),
    retry: false,
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(38rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="border-b px-6 pt-5 pb-3.5">
          <DialogTitle>{profile.title}</DialogTitle>
          <DialogDescription>生成的 sing-box 配置，只读</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-5">
          {isPending && <Skeleton className="h-full w-full rounded-lg" />}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
          {data?.warnings && (
            <pre className="rounded-lg bg-muted px-3.5 py-2.5 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{data.warnings}</pre>
          )}
          {data && <pre className="rounded-lg border px-3.5 py-2.5 font-mono text-xs leading-5">{data.content}</pre>}
        </div>
        <DialogFooter className="border-t px-6 py-3.5">
          <DialogClose render={<Button type="button" variant="outline" />}>关闭</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
