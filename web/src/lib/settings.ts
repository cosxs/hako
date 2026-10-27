import { queryOptions } from '@tanstack/react-query'

import { addSection, apply, deleteOptions, getSection, revert, setOptions } from '@/lib/uci'

// the settings of Hako itself, in the hako package: the latency tests

// what the latency tests use when none is set: sing-box's URL, and the
// timeout of the rpcd plugin
const TEST_URL = 'https://www.gstatic.com/generate_204'
const TEST_TIMEOUT = '5'

export type Settings = {
  testUrl: string
  // seconds, or another duration as it is
  testTimeout: string
}

function text(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

// a timeout in seconds, as the page takes it; another duration is kept as it is
function seconds(value: string) {
  const match = /^(\d+)s$/.exec(value)
  return match ? match[1] : value
}

export const settingsQuery = queryOptions({
  queryKey: ['hako', 'settings'],
  queryFn: async (): Promise<Settings> => {
    const latency = await getSection('hako', 'latency').catch(() => null)
    return {
      testUrl: text(latency?.url) || TEST_URL,
      testTimeout: seconds(text(latency?.timeout)) || TEST_TIMEOUT,
    }
  },
})

// a section of the hako package written: the options with a value set, those
// empty removed; one there is not yet is added
async function writeSection(name: string, values: Record<string, string>) {
  const exists = await getSection('hako', name).then(
    () => true,
    () => false,
  )
  if (!exists) {
    await addSection('hako', 'hako', Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '')), name)
    return
  }
  const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
  const unset = Object.keys(values).filter((key) => values[key] === '')
  if (Object.keys(set).length) await setOptions('hako', name, set)
  if (unset.length) await deleteOptions('hako', name, unset)
}

// sections written, then applied; reverted when one fails
async function applying(change: () => Promise<void>) {
  try {
    await change()
    await apply()
  } catch (error) {
    await revert('hako').catch(() => {})
    throw error
  }
}

export async function saveSettings(values: Settings) {
  const timeout = values.testTimeout.trim()
  await applying(() =>
    writeSection('latency', {
      url: values.testUrl.trim(),
      timeout: /^\d+$/.test(timeout) ? (Number(timeout) > 0 ? `${timeout}s` : '') : timeout,
    }),
  )
}
