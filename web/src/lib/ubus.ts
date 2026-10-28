// The router's ubus over HTTP (JSON-RPC at /ubus), as LuCI uses it: a call
// names a session, an object, a method and its arguments. The session is the
// one of LuCI, and lasts as long as it is used.

const ENDPOINT = '/ubus'
const SESSION_KEY = 'hako.session'

export class UbusError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'UbusError'
    this.code = code
  }
}

function readSession() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // the session then lasts until the page is reloaded
  }
}

let session = readSession()
let lastId = 0
const expiredListeners = new Set<() => void>()

export function hasSession() {
  return session != null
}

// called once a session is no longer accepted, so the app can go to LuCI to
// log in
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener)
  return () => {
    expiredListeners.delete(listener)
  }
}

// once, as the session goes: the calls that fail after it, such as the
// queries refetched as the app leaves, do not send it to the login again
function expire() {
  if (!session) return
  session = null
  writeSession(null)
  expiredListeners.forEach((listener) => listener())
}

async function rpc<T>(sid: string, object: string, method: string, params: object): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++lastId, method: 'call', params: [sid, object, method, params] }),
  })
  if (!response.ok) throw new UbusError(-1, `HTTP ${response.status}`)

  const reply = await response.json()
  if (reply.error) {
    // -32002: the session is unknown or has timed out
    if (reply.error.code === -32002 && sid === session) expire()
    throw new UbusError(reply.error.code, reply.error.message)
  }

  const [code, data] = reply.result as [number, T?]
  if (code !== 0) throw new UbusError(code, `ubus ${object}.${method}: status ${code}`)

  return (data ?? {}) as T
}

export function call<T = Record<string, unknown>>(object: string, method: string, params: object = {}) {
  if (!session) return Promise.reject(new UbusError(-32002, 'Not logged in'))

  return rpc<T>(session, object, method, params)
}

// LuCI logs in: its Hako entry writes the session of LuCI into the storage
// this app shares with it, on the same origin, and opens the app again at the
// page it was sent away from
const LUCI_ENTRY = '/cgi-bin/luci/admin/services/hako'
const RETURN_KEY = 'hako.return'

export function toLuci(path?: string) {
  try {
    if (path) localStorage.setItem(RETURN_KEY, path)
  } catch {
    // the app then opens at its first page
  }
  location.replace(LUCI_ENTRY)
}

// the page to open again once back from LuCI, read once
export function returnPath() {
  try {
    const path = localStorage.getItem(RETURN_KEY)
    localStorage.removeItem(RETURN_KEY)
    return path
  } catch {
    return null
  }
}

// a file written on the router through LuCI's cgi-upload, which the session
// must be allowed to write by the ACL of the app
export async function upload(path: string, file: File) {
  if (!session) throw new UbusError(-32002, 'Not logged in')
  const form = new FormData()
  form.append('sessionid', session)
  form.append('filename', path)
  form.append('filedata', file)
  const response = await fetch('/cgi-bin/cgi-upload', { method: 'POST', body: form })
  if (!response.ok) throw new UbusError(-1, `HTTP ${response.status}`)
  const reply = await response.json().catch(() => null)
  if (!reply || reply.failure) throw new UbusError(-1, reply?.message ?? 'upload failed')
}
