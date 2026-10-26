import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { runtimeQuery, selectOutbound, testGroup, type Runtime } from '@/lib/policy'

// the running sing-box as the policy page shows it: the groups with their
// current outbound, the latest delays, and the latency tests under way

type PolicyRuntime = {
  runtime: Runtime | undefined
  group: (tag: string) => { type: string; now: string; all: string[] } | undefined
  // the delay to show: measured, 0 when it did not answer the last test, or
  // null when never measured
  delay: (name: string) => number | null
  testing: (group: string) => boolean
  test: (group: string) => void
  select: (group: string, outbound: string) => void
}

const Context = createContext<PolicyRuntime | null>(null)

export function PolicyRuntimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data: runtime } = useQuery(runtimeQuery)
  const [testing, setTesting] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())

  const group = useCallback(
    (tag: string) => (runtime?.available ? runtime.groups[tag] : undefined),
    [runtime],
  )

  // the latest delay sing-box measured; a group without one of its own has
  // the one of its current outbound
  const delay = useCallback(
    (name: string) => {
      if (!runtime?.available) return null
      for (let depth = 0, current = name; depth < 8; depth++) {
        const measured = runtime.delays[current]
        if (measured > 0) return measured
        const next = runtime.groups[current]
        if (!next) break
        current = next.now
      }
      return failed.has(name) ? 0 : null
    },
    [runtime, failed],
  )

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: runtimeQuery.queryKey }), [queryClient])

  const test = useCallback(
    (tag: string) => {
      if (testing.has(tag)) return
      setTesting((current) => new Set(current).add(tag))
      testGroup(tag)
        .then((delays) => {
          // those that did not answer show a timeout until they answer again
          const members = group(tag)?.all ?? []
          setFailed((current) => {
            const next = new Set(current)
            for (const name of members) {
              if (delays[name] > 0) next.delete(name)
              else next.add(name)
            }
            return next
          })
        })
        .catch((error: Error) => toast.error(error.message))
        .finally(() => {
          setTesting((current) => {
            const next = new Set(current)
            next.delete(tag)
            return next
          })
          refresh()
        })
    },
    [testing, group, refresh],
  )

  const selectMutation = useMutation({
    mutationFn: ({ group, outbound }: { group: string; outbound: string }) => selectOutbound(group, outbound),
    onError: (error: Error) => toast.error(error.message),
    onSettled: refresh,
  })

  const value = useMemo<PolicyRuntime>(
    () => ({
      runtime,
      group,
      delay,
      testing: (tag) => testing.has(tag),
      test,
      select: (group, outbound) => selectMutation.mutate({ group, outbound }),
    }),
    [runtime, group, delay, testing, test, selectMutation],
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function usePolicyRuntime() {
  const value = useContext(Context)
  if (!value) throw new Error('usePolicyRuntime outside PolicyRuntimeProvider')
  return value
}
