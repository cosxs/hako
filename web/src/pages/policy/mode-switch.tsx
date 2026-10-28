import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { modeName, setMode, statusQuery } from '@/lib/hako'

// the default modes first, in this order, then those the rules name
const ORDER = ['direct', 'global', 'rule']

// the outbound mode, switched at once; centered unless told otherwise
export function ModeSwitch({ className = 'flex justify-center' }: { className?: string }) {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(statusQuery)
  const mutation = useMutation({
    mutationFn: setMode,
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hako'] }),
  })

  // until the status is in, the default modes hold the place of the switch,
  // none chosen, so the page below does not move once it is
  const api = status?.clash_api
  if (status && !api) return null

  const modes = api
    ? [...api.modes].sort((a, b) => {
        const rank = (mode: string) => {
          const index = ORDER.indexOf(mode.toLowerCase())
          return index < 0 ? ORDER.length : index
        }
        return rank(a) - rank(b)
      })
    : ORDER
  const current = api ? (modes.find((mode) => mode.toLowerCase() === api.mode.toLowerCase()) ?? api.mode) : null

  return (
    <div className={className}>
      <Tabs value={current} onValueChange={(mode) => mode !== current && mutation.mutate(String(mode))}>
        <TabsList className="w-full max-w-md">
          {modes.map((mode) => (
            <TabsTrigger key={mode} value={mode} disabled={!api || mutation.isPending} className="px-6">
              {modeName(mode)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
