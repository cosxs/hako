// The router's ubus over HTTP (JSON-RPC at /ubus), as LuCI uses it: a call
// names a session, an object, a method and its arguments. The session comes
// from logging in with a system account, root on most routers, and lasts as
// long as it is used.

const ENDPOINT = '/ubus'
const NULL_SESSION = '00000000000000000000000000000000'
const SESSION_KEY = 'hako.session'

// how long a session lasts without being used, in seconds
const SESSION_TIMEOUT = 3600

// ubus status codes
export const UBUS_PERMISSION_DENIED = 6

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

// called once a session is no longer accepted, so the app can ask to log in
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener)
  return () => {
    expiredListeners.delete(listener)
  }
}

function expire() {
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
    if (reply.error.code === -32002 && sid !== NULL_SESSION) expire()
    throw new UbusError(reply.error.code, reply.error.message)
  }

  const [code, data] = reply.result as [number, T?]
  if (code !== 0) throw new UbusError(code, `ubus ${object}.${method}: status ${code}`)

  return (data ?? {}) as T
}

export function call<T = Record<string, unknown>>(object: string, method: string, params: object = {}) {
  if (!session) {
    expire()
    return Promise.reject(new UbusError(-32002, 'Not logged in'))
  }

  return rpc<T>(session, object, method, params)
}

// a wrong user name or password is UBUS_PERMISSION_DENIED
export async function login(username: string, password: string) {
  const result = await rpc<{ ubus_rpc_session: string }>(NULL_SESSION, 'session', 'login', {
    username,
    password,
    timeout: SESSION_TIMEOUT,
  })

  session = result.ubus_rpc_session
  writeSession(session)
}

export async function logout() {
  const id = session
  session = null
  writeSession(null)
  if (id) await rpc(id, 'session', 'destroy', {}).catch(() => {})
}
