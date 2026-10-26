import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { Spinner } from '@/components/ui/spinner'
import { effectToast, untilApplied } from '@/lib/hako'
import { deleteOutbound, outboundUsers } from '@/lib/outbounds'
import { label, type Profile } from '@/lib/policy'
import type { UciSection } from '@/lib/uci'

// deleting a group or a node: the groups listing it no longer do; one still
// used anywhere else is not deleted, and the dialog says where
export function DeleteOutboundDialog({
  profile,
  section,
  kind,
  onOpenChange,
}: {
  profile: Profile | undefined
  section: UciSection | null
  kind: '策略组' | '节点'
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (target: UciSection) => untilApplied(() => deleteOutbound(profile!, target)),
    onSuccess: ({ effect }, target) => {
      effectToast(`已删除 ${label(target)}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error, target) => toast.error(`无法删除 ${label(target)}：${error.message}`),
  })

  const users = profile && section ? outboundUsers(profile, section) : { groups: [], blockers: [] }
  const blocked = users.blockers.length > 0
  const name = section ? label(section) : ''

  return (
    <AlertDialog open={!!section} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{blocked ? `不能删除${kind}「${name}」` : `删除${kind}「${name}」？`}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>
              {blocked
                ? '下面这些仍在使用它，请先改掉。'
                : users.groups.length
                  ? '下面的策略组列出了它，删除后会从中去掉。这一步不能撤销。'
                  : '这一步不能撤销。'}
            </p>
            {(blocked || users.groups.length > 0) && (
              <ul className="list-disc pl-5 text-foreground">
                {blocked ? users.blockers.map((text) => <li key={text}>{text}</li>) : users.groups.map((group) => <li key={group['.name']}>策略组：{label(group)}</li>)}
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
