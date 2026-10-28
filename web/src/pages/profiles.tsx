import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EllipsisIcon, PlusIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/reui/badge'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createProfile, deleteProfile, profilesQuery, switchProfile, viewProfile, type ProfileEntry } from '@/lib/profiles'
import { StackedField } from '@/pages/rules/form'

// the profiles: each made from the template, one in use; the config a profile
// makes is shown read-only
export function ProfilesPage() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery(profilesQuery)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<ProfileEntry | null>(null)
  const [deleting, setDeleting] = useState<ProfileEntry | null>(null)

  const failure = error?.message
  useEffect(() => {
    if (failure) toast.error(`读取配置文件失败：${failure}`, { id: 'profiles-error' })
  }, [failure])

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
      queryClient.invalidateQueries({ queryKey: ['hako'] })
    },
    onError: (error: Error, profile) => toast.error(`无法删除 ${profile.title}：${error.message}`),
  })

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setCreating(true)}>
          <PlusIcon />
          新建…
        </Button>
      </div>
      {!data ? (
        <Skeleton className="h-36 w-full rounded-xl" />
      ) : (
        <div className="overflow-hidden rounded-xl border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">配置名</TableHead>
                <TableHead className="w-28" />
                <TableHead className="w-36 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.profiles.map((profile) => {
                const current = profile.name === data.profile
                return (
                  <TableRow key={profile.name}>
                    <TableCell className="pl-4">
                      <button type="button" className="text-left hover:underline" onClick={() => setViewing(profile)}>
                        {profile.title}
                      </button>
                    </TableCell>
                    <TableCell>{current && <Badge variant="success-light">使用中</Badge>}</TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {!current && (
                          <Button variant="outline" size="sm" disabled={use.isPending} onClick={() => use.mutate(profile)}>
                            {use.isPending && use.variables?.name === profile.name && <Spinner />}
                            使用
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${profile.title} 的更多操作`} />}>
                            <EllipsisIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setViewing(profile)}>查看</DropdownMenuItem>
                            {!current && (
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(profile)}>
                                删除
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && <CreateDialog titles={data?.profiles.map((profile) => profile.title) ?? []} onOpenChange={setCreating} />}
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

// a new profile from the template, with only its name
function CreateDialog({ titles, onOpenChange }: { titles: string[]; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [touched, setTouched] = useState(false)
  const invalid = !title.trim() || titles.includes(title.trim())

  const create = useMutation({
    mutationFn: () => createProfile(title),
    onSuccess: () => {
      toast.success(`已新建 ${title.trim()}`)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`无法新建配置：${error.message}`),
  })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (!invalid) create.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>新建配置</DialogTitle>
            <DialogDescription>基于内置模板新建，之后在各页修改。</DialogDescription>
          </DialogHeader>
          <StackedField label="配置名" htmlFor="profile-title">
            <Input id="profile-title" autoFocus value={title} aria-invalid={touched && invalid} onChange={(event) => setTitle(event.target.value)} />
          </StackedField>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              新建
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
