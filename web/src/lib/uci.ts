import { call, UbusError } from '@/lib/ubus'

// UCI through ubus. Changes are kept in the session until applied; applying
// them commits and reloads the services they concern, and rolls them back
// unless confirmed within the timeout, as LuCI's "Save & Apply" does.

export type UciSection = Record<string, string | string[]> & {
  '.name': string
  '.type': string
  '.anonymous': boolean
  '.index': number
}

const APPLY_TIMEOUT = 30
// what uci apply answers when there is nothing to apply
const UBUS_NO_DATA = 5

export async function getConfig(config: string) {
  const result = await call<{ values: Record<string, UciSection> }>('uci', 'get', { config })
  return Object.values(result.values).sort((a, b) => a['.index'] - b['.index'])
}

export async function getSection(config: string, section: string) {
  const result = await call<{ values: UciSection }>('uci', 'get', { config, section })
  return result.values
}

export function setOptions(config: string, section: string, values: Record<string, string | string[]>) {
  return call('uci', 'set', { config, section, values })
}

export async function addSection(config: string, type: string, values?: Record<string, string | string[]>, name?: string) {
  const result = await call<{ section: string }>('uci', 'add', { config, type, name, values })
  return result.section
}

export function deleteSection(config: string, section: string) {
  return call('uci', 'delete', { config, section })
}

export function deleteOptions(config: string, section: string, options: string[]) {
  return call('uci', 'delete', { config, section, options })
}

// the sections of a package in this order; the anonymous ones are named by
// their position once committed
export function order(config: string, sections: string[]) {
  return call('uci', 'order', { config, sections })
}

export async function changes() {
  const result = await call<{ changes?: Record<string, unknown[]> }>('uci', 'changes')
  return result.changes ?? {}
}

export function revert(config: string) {
  return call('uci', 'revert', { config })
}

// apply what the session changed, then confirm: if the router cannot be
// reached once the services reloaded, the confirmation fails and the
// changes roll back by themselves
export async function apply() {
  try {
    await call('uci', 'apply', { rollback: true, timeout: APPLY_TIMEOUT })
  } catch (error) {
    // nothing changed: saving what is there already applies nothing
    if (error instanceof UbusError && error.code === UBUS_NO_DATA) return
    throw error
  }
  await call('uci', 'confirm')
}
