import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Alert, AlertTitle } from '@/components/reui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { login, UBUS_PERMISSION_DENIED, UbusError } from '@/lib/ubus'

function errorText(error: Error) {
  if (error instanceof UbusError && error.code === UBUS_PERMISSION_DENIED) return '用户名或密码不对。'
  return `无法连接路由器：${error.message}`
}

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const mutation = useMutation({ mutationFn: () => login(username, password), onSuccess: onLogin })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Hako</CardTitle>
          <CardDescription>用路由器的系统账户登录，通常是 root。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">用户名</FieldLabel>
                <Input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input id="password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
              {mutation.error && (
                <Alert variant="destructive">
                  <AlertTitle>{errorText(mutation.error)}</AlertTitle>
                </Alert>
              )}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Spinner />}
                登录
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
