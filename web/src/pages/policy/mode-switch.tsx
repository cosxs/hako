import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { modeName, setMode, statusQuery } from '@/lib/hako'

// the default modes first, in this order, then those the rules name
const ORDER = ['direct', 'global', 'rule']

// the outbound mode, switched at once
export function ModeSwitch() {
  const queryClient = useQueryClient()
  const { data: status } = useQuery(statusQuery)
  const mutation = useMutation({
    mutationFn: setMode,
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['hako'] }),
  })

  const api = status?.clash_api
  if (!api) return null

  const modes = [...api.modes].sort((a, b) => {
    const rank = (mode: string) => {
      const index = ORDER.indexOf(mode.toLowerCase())
      return index < 0 ? ORDER.length : index
    }
    return rank(a) - rank(b)
  })
  const current = modes.find((mode) => mode.toLowerCase() === api.mode.toLowerCase()) ?? api.mode

  return (
    <div className="flex justify-center">
      <Tabs value={current} onValueChange={(mode) => mode !== current && mutation.mutate(String(mode))}>
        <TabsList className="w-full max-w-md">
          {modes.map((mode) => (
            <TabsTrigger key={mode} value={mode} disabled={mutation.isPending} className="px-6">
              {modeName(mode)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}
