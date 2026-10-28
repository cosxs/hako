import { MinusIcon, PlusIcon } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

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
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { joined, validJsonObject } from '@/lib/core'
import type { UciSection } from '@/lib/uci'
import { cn } from '@/lib/utils'

// the controls of the core settings, on the muted cards of their rows

export function TextInput({
  id,
  value,
  invalid,
  mono,
  type,
  onChange,
}: {
  id: string
  value: string
  invalid?: boolean
  mono?: boolean
  type?: string
  onChange: (value: string) => void
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      aria-invalid={invalid}
      className={cn('bg-background', mono && 'font-mono text-[13px]')}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function UnitInput({
  id,
  value,
  unit,
  invalid,
  onChange,
}: {
  id: string
  value: string
  unit: string
  invalid?: boolean
  onChange: (value: string) => void
}) {
  return (
    <InputGroup className="bg-background">
      <InputGroupInput id={id} value={value} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)} />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{unit}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}

// a choice of items, value to text; one set that is none of them stays a choice
export function ChoiceSelect({
  id,
  items,
  value,
  invalid,
  mono,
  onChange,
}: {
  id: string
  items: Record<string, string>
  value: string
  invalid?: boolean
  mono?: boolean
  onChange: (value: string) => void
}) {
  const all = value && !(value in items) ? { ...items, [value]: value } : items
  return (
    <Select items={all} value={value in all ? value : null} onValueChange={(next) => onChange(String(next ?? ''))}>
      <SelectTrigger id={id} aria-invalid={invalid} className={cn('w-full bg-background data-placeholder:text-foreground', mono && 'font-mono text-[13px]')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {Object.entries(all).map(([item, text]) => (
          <SelectItem key={item} value={item} className={cn(mono && 'font-mono text-[13px]')}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// the button that saves a tab
export function SaveButton({ pending }: { pending: boolean }) {
  return (
    <div className="flex justify-end">
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        保存
      </Button>
    </div>
  )
}

// sections of a type in a table, as the rule sets are: a click selects one,
// a double click opens it; + adds one and − deletes the one selected
export function SectionTable({
  label,
  columns,
  sections,
  cells,
  busy,
  onOpen,
  onDelete,
}: {
  label: string
  columns: string[]
  sections: UciSection[]
  cells: (section: UciSection) => ReactNode[]
  busy?: boolean
  onOpen: (section: UciSection | null) => void
  onDelete: (section: UciSection) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const selectedSection = sections.find((section) => section['.name'] === selected) ?? null

  const keyDown = (event: KeyboardEvent, section: UciSection) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(section)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      onDelete(section)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border shadow-xs">
      <Table className="table-fixed select-none">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column, index) => (
              <TableHead key={column} className={cn(index === 0 && 'pl-4', index === columns.length - 1 && 'pr-4')}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => {
            const name = section['.name']
            return (
              <TableRow
                key={name}
                tabIndex={0}
                data-state={selected === name ? 'selected' : undefined}
                className="cursor-default"
                onClick={() => setSelected(name)}
                onDoubleClick={() => onOpen(section)}
                onKeyDown={(event) => keyDown(event, section)}
              >
                {cells(section).map((cell, index) => (
                  <TableCell key={index} className={cn('truncate font-mono text-[13px]', index === 0 && 'pl-4', index === columns.length - 1 && 'pr-4')}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
          {!sections.length && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                {joined('还没有', label)}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center gap-1 border-t bg-muted/50 px-3 py-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label={joined('添加', label)} disabled={busy} onClick={() => onOpen(null)}>
          <PlusIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={joined('删除选中的', label)}
          disabled={busy || !selectedSection}
          onClick={() => selectedSection && onDelete(selectedSection)}
        >
          <MinusIcon />
        </Button>
      </div>
    </div>
  )
}

// a section deleted; one still used is not, and the dialog says where
export function DeleteSectionDialog({
  kind,
  name,
  users,
  open,
  pending,
  onDelete,
  onOpenChange,
}: {
  kind: string
  name: string
  users: string[]
  open: boolean
  pending: boolean
  onDelete: () => void
  onOpenChange: (open: boolean) => void
}) {
  const blocked = users.length > 0
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{blocked ? `${joined('不能删除', kind)}「${name}」` : `${joined('删除', kind)}「${name}」？`}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>{blocked ? '下面这些仍在使用它，请先改掉。' : '这一步不能撤销。'}</p>
            {blocked && (
              <ul className="list-disc pl-5 break-all text-foreground">
                {users.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? '知道了' : '取消'}</AlertDialogCancel>
          {!blocked && (
            <AlertDialogAction variant="destructive" disabled={pending} onClick={onDelete}>
              {pending && <Spinner />}
              删除
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// sing-box fields written as a JSON object, in a dialog of their own; done
// gives them back to the form, which saves them
export function JsonFieldsDialog({
  title,
  value,
  onDone,
  onOpenChange,
}: {
  title: string
  value: string
  onDone: (value: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const [text, setText] = useState(value)
  const [tried, setTried] = useState(false)
  const valid = validJsonObject(text)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            // the form of the page is not submitted with it
            event.stopPropagation()
            setTried(true)
            if (!valid) return
            onDone(text)
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">sing-box 字段的 JSON 对象，保存页面时一并保存。</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={title}
            rows={10}
            spellCheck={false}
            value={text}
            aria-invalid={tried && !valid}
            className="max-h-96 min-h-48 font-mono text-[13px]"
            onChange={(event) => setText(event.target.value)}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>取消</DialogClose>
            <Button type="submit">完成</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
