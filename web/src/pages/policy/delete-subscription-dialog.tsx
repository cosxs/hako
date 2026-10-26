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
import { deleteSubscription, type Subscription } from '@/lib/policy'

// deleting a subscription: what it downloaded goes too, and the groups that
// list it no longer do
export function DeleteSubscriptionDialog({ sub, onOpenChange }: { sub: Subscription | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (target: Subscription) => untilApplied(() => deleteSubscription(target.name)),
    onSuccess: ({ effect }, target) => {
      effectToast(`已删除 ${target.tag}`, effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error, target) => toast.error(`无法删除 ${target.tag}：${error.message}`),
  })

  return (
    <AlertDialog open={!!sub} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除订阅「{sub?.tag}」？</AlertDialogTitle>
          <AlertDialogDescription>订阅和它下载的节点都会删除，列出它的策略组也不再包含它。这一步不能撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={() => sub && mutation.mutate(sub)}>
            {mutation.isPending && <Spinner />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
