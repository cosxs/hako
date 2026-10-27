import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MinusIcon, PlusIcon } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { effectToast, untilApplied } from '@/lib/hako'
import { label, type Profile } from '@/lib/policy'
import { deleteRuleSet, inboundsQuery, RULE_SET_TYPES, ruleSetFormat, ruleSets, ruleSetSource, ruleSetType, ruleSetUsers } from '@/lib/rules'
import type { UciSection } from '@/lib/uci'
import { RuleSetDialog } from '@/pages/rules/rule-set-dialog'

// the rule sets of the profile, which rules name by their tags: selected by
// a click, opened by a double click. One a rule or anything else uses is not
// deleted
export function RuleSetList({ profile, search }: { profile: Profile | undefined; search: string }) {
  const inboundsResult = useQuery(inboundsQuery)
  const inbounds = inboundsResult.data ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [opened, setOpened] = useState<{ section: UciSection | null } | null>(null)
  const [deleting, setDeleting] = useState<UciSection | null>(null)

  const sets = profile ? ruleSets(profile) : []
  const query = search.trim().toLowerCase()
  const shown = sets.filter((set) => !query || [label(set), ruleSetSource(set)].some((part) => part.toLowerCase().includes(query)))
  const selectedSet = sets.find((set) => set['.name'] === selected) ?? null
  const open = (set: UciSection) => setOpened({ section: set })
  const ready = !!profile && inboundsResult.isSuccess

  const keyDown = (event: KeyboardEvent, set: UciSection) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      open(set)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setDeleting(set)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border shadow-xs">
      <Table className="min-w-[760px] table-fixed select-none">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-48 pl-4">名称</TableHead>
            <TableHead className="w-20">类型</TableHead>
            <TableHead className="w-20">格式</TableHead>
            <TableHead>地址或路径</TableHead>
            <TableHead className="w-20 pr-4 text-right">引用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!ready
            ? Array.from({ length: 3 }, (_, index) => (
                <TableRow key={index} className="hover:bg-transparent">
                  <TableCell colSpan={5} className="px-4">
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : shown.map((set) => {
                const name = set['.name']
                const source = ruleSetSource(set)
                return (
                  <TableRow
                    key={name}
                    tabIndex={0}
                    data-state={selected === name ? 'selected' : undefined}
                    className="cursor-default"
                    onClick={() => setSelected(name)}
                    onDoubleClick={() => open(set)}
                    onKeyDown={(event) => keyDown(event, set)}
                  >
                    <TableCell className="truncate pl-4 font-mono text-[13px]">{label(set)}</TableCell>
                    <TableCell>{RULE_SET_TYPES[ruleSetType(set)]}</TableCell>
                    <TableCell className="font-mono text-[13px]">{ruleSetFormat(set)}</TableCell>
                    <TableCell className="truncate font-mono text-[13px]" title={source}>
                      {source}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{ruleSetUsers(profile, inbounds, set).length}</TableCell>
                  </TableRow>
                )
              })}
          {ready && !shown.length && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                {query ? '没有匹配的规则集' : '还没有规则集'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center gap-1 border-t bg-muted/50 px-3 py-2">
        <Button variant="outline" size="icon-sm" aria-label="添加规则集" disabled={!ready} onClick={() => setOpened({ section: null })}>
          <PlusIcon />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="删除选中的规则集" disabled={!ready || !selectedSet} onClick={() => setDeleting(selectedSet)}>
          <MinusIcon />
        </Button>
      </div>

      {profile && opened && <RuleSetDialog profile={profile} section={opened.section} onOpenChange={(open) => !open && setOpened(null)} />}
      {profile && (
        <DeleteRuleSetDialog
          profile={profile}
          inbounds={inbounds}
          section={deleting}
          onOpenChange={(open) => {
            if (open) return
            if (deleting && selected === deleting['.name']) setSelected(null)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

// a rule set deleted; one still used is not, and the dialog says where
function DeleteRuleSetDialog({
  profile,
  inbounds,
  section,
  onOpenChange,
}: {
  profile: Profile
  inbounds: UciSection[]
  section: UciSection | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (target: UciSection) => untilApplied(() => deleteRuleSet(profile, target)),
    onSuccess: ({ effect }, target) => {
      effectToast(`已删除规则集 ${label(target)}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error, target) => toast.error(`无法删除规则集 ${label(target)}：${error.message}`),
  })

  const users = section ? ruleSetUsers(profile, inbounds, section) : []
  const blocked = users.length > 0
  const name = section ? label(section) : ''

  return (
    <AlertDialog open={!!section} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{blocked ? `不能删除规则集「${name}」` : `删除规则集「${name}」？`}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>{blocked ? '下面这些仍在使用它，请先改掉。' : '这一步不能撤销。'}</p>
            {blocked && (
              <ul className="list-disc pl-5 break-all text-foreground">
                {users.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? '知道了' : '取消'}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={() => section && mutation.mutate(section)}>
              {mutation.isPending && <Spinner />}
              删除
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
