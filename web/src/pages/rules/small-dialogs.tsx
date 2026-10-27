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
import type { Profile, Subscription } from '@/lib/policy'
import { deleteRule, outboundChoice, outboundText, ruleText } from '@/lib/rules'
import type { UciSection } from '@/lib/uci'

// a rule deleted, with its conditions
export function DeleteRuleDialog({
  profile,
  subscriptions,
  section,
  onOpenChange,
}: {
  profile: Profile
  subscriptions: Subscription[]
  section: UciSection | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (target: UciSection) => untilApplied(() => deleteRule(profile, target)),
    onSuccess: ({ effect }) => {
      effectToast('已删除规则', effect)
      queryClient.invalidateQueries({ queryKey: ['hako'] })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(`无法删除规则：${error.message}`),
  })

  const text = section ? ruleText(profile, section) : null
  return (
    <AlertDialog open={!!section} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除这条规则？</AlertDialogTitle>
          <AlertDialogDescription className="break-all">
            {text && section && `${text.type} ${text.value} → ${outboundText(profile, subscriptions, outboundChoice(profile, subscriptions, section))}。`}
            这一步不能撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={() => section && mutation.mutate(section)}>
            {mutation.isPending && <Spinner />}
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
