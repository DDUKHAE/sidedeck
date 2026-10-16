import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { Limits } from '../types'

import { flatten, matchPaths, mentionOf, sortEntries, walkFiles } from './tree'
import type { Entry } from './tree'

const PANE = 'sidedeck'
const expanded = atom({ plugin: 'sidedeck', key: 'expanded' } as const, [])
const viewing = atom({ plugin: 'sidedeck', key: 'viewing' } as const, null)
const editing = atom({ plugin: 'sidedeck', key: 'editing' } as const, false)
const treeTop = atom({ plugin: 'sidedeck', key: 'treeTop' } as const, 0)
const query = atom({ plugin: 'sidedeck', key: 'query' } as const, '')
const limits = atom({ plugin: 'sidedeck', key: 'limits' } as const, { fiveHour: null, week: null } as Limits)
const TREE_COLS = 36
const EDIT_COLS = 90
const MAX_CHARS = 100_000

// Listings are read once and kept until a tool that can change files runs (the tool.call hook).
// ponytail: edits made outside Claude Code show after the next such tool or an `r`; add a poll if that bites
const children = new Map<string, Entry[]>()
let allFiles: string[] | null = null // every file under the root, for search
const CHANGES_FILES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])

function refresh($: any) {
  children.clear()
  allFiles = null
  $.ui.invalidate('ui.render')
}

async function mention($: any, path: string) {
  const text = mentionOf(path, await $.session.cwd())
  if (!text) return $.ui.toast('Not added: the name holds a quote or a control character')
  const filled = await $.prompt.fill({ text, mode: 'insert' }).catch(() => ({ isFilled: false }))
  $.ui.toast(filled.isFilled ? `Added ${text.trim()} to the prompt` : 'Could not add to the prompt')
}

// What the last drawing showed, so the arrow keys and the wheel can walk it.
let rowKeys: string[] = [] // every row of the tree, drawn or not
let focused = ''
let treeRows = 20 // how many tree rows the window shows

// The tree draws its own window of rows under a header that stays put: the engine's own
// scroll is held one row in, with a blank row above and below, so every arrow and wheel
// tick reaches the ui.scroll hook (the engine only asks while it has room to move).
const HELD = 1

export function clampTop(top: number, rows: number, shown: number): number {
  return Math.max(0, Math.min(top, rows - shown))
}

function readLimits(rl: SessionRateLimit[]): Limits {
  const used = (kind: string) => rl.find(r => r.kind === kind)?.percentUsed ?? null
  return { fiveHour: used('five_hour'), week: used('seven_day') }
}

export function limitsText(l: Limits): string {
  const left = (used: number | null) => (used === null ? '–' : `${Math.max(0, Math.round(100 - used))}%`)
  return l.fiveHour === null && l.week === null ? '' : `5h ${left(l.fiveHour)} · 7d ${left(l.week)} left`
}

// The window top that keeps body row `row` in view.
export function follow(row: number, top: number, bodyRows: number): number {
  if (row < top) return row
  if (row >= top + bodyRows) return row - bodyRows + 1
  return top
}

async function load($: any, dir: string) {
  if (children.has(dir)) return
  const list = await $.fs.list(dir).catch(() => [])
  children.set(dir, sortEntries(list))
}

// Text the pane can draw: no control characters but tab and newline, cut to what one drawing shows.
export function displayable(raw: string): string {
  if (raw.includes('\u0000')) return '(binary file, not shown)'
  const clean = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
  return clean.length > MAX_CHARS ? `${clean.slice(0, MAX_CHARS)}\n\n… (cut at ${MAX_CHARS} characters)` : clean
}

let fileText = ''
let canEdit = false // only a file shown exactly as it is on disk: saving it back changes nothing unasked

async function view($: any, path: string) {
  const raw: string | null = await $.fs.read(path).catch(() => null)
  fileText = raw === null ? '(could not read the file)' : displayable(raw)
  canEdit = raw !== null && fileText === raw
  await update($, editing, () => false)
  await update($, viewing, () => path)
}

async function edit($: any, on: boolean) {
  await update($, editing, () => on)
  // A wider dock while editing; the person's own drag still wins.
  void $.ui.open({ id: PANE, title: 'Sidedeck', columns: on ? EDIT_COLS : TREE_COLS }).catch(() => undefined)
}

async function back($: any, path: string) {
  const at = rowKeys.indexOf(`row:${path}`)
  if (at !== -1) await update($, treeTop, t => follow(at, t, treeRows))
  await update($, viewing, () => null)
  void $.ui.focus({ requestId: PANE, key: `row:${path}` }).catch(() => undefined)
}

async function toggle($: any, dir: string) {
  await load($, dir)
  await update($, expanded, list => (list.includes(dir) ? list.filter(p => p !== dir) : [...list, dir]))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sidedeck', description: 'Open the sidedeck file pane beside the conversation' })
    await update($, limits, () => readLimits([]))
    const usage = await $.session.usage().catch(() => null)
    if (usage) await update($, limits, () => readLimits(usage.rateLimits))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limits, () => readLimits(e.rateLimits))
    return next(e)
  })

  on('command.run', { command: 'sidedeck' }, async $ => {
    await load($, await $.session.cwd())
    await $.ui.open({ id: PANE, title: 'Sidedeck', focus: true, columns: TREE_COLS })
    void $.ui.scroll({ in: PANE, to: { key: 'head' }, block: 'start' }).catch(() => undefined)
    return { text: 'Sidedeck opened. ctrl+x Tab to enter, Tab/arrows to move, Enter to fold a folder or open a file, f find, a add to prompt, r refresh (b/q back, i edit), Escape back to the prompt.' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (CHANGES_FILES.has(String(e.tool))) refresh($)
    return result
  }).catch(($, e, next) => next(e)) // a failed refresh never touches the tool call itself

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) focused = e.element ?? ''
    return result
  }).catch(($, e, next) => next(e))

  // In the tree every scroll is the hook's: arrows walk the rows like Tab does, the wheel
  // and page keys move the window, and the engine's window stays held under the header.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || rowKeys.length === 0 || (await read($, viewing)) !== null) return next(e)
    const top = await read($, treeTop)
    if (e.pointer === undefined && Math.abs(e.by) === 1) {
      const at = rowKeys.indexOf(focused)
      const to = at === -1 ? top : Math.min(rowKeys.length - 1, Math.max(0, at + e.by))
      await update($, treeTop, () => follow(to, top, treeRows))
      void $.ui.focus({ requestId: PANE, key: rowKeys[to] }).catch(() => undefined)
    } else {
      await update($, treeTop, () => clampTop(top + e.by, rowKeys.length, treeRows))
    }
    return next({ ...e, offset: HELD })
  }).catch(($, e, next) => next(e))

  // The editor posts its text on ctrl+s, and asks to close on ctrl+q.
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const msg = e.data as { type?: string; text?: unknown; close?: boolean } | null
    const open = await read($, viewing)
    if (!msg || open === null) return {}
    if (msg.type === 'save' && typeof msg.text === 'string') {
      const text = msg.text
      const saved = await $.fs.write(open, text).then(() => true, (err: Error) => ($.ui.toast(`Not saved: ${err.message}`), false))
      if (saved) fileText = text
      if (saved && msg.close) await edit($, false)
    }
    if (msg.type === 'close') await edit($, false)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Code } = ui
    const Client = 'Client' in ui ? ui.Client : undefined // the mobile app draws none: no editing there
    const root = await $.session.cwd()
    const open = await read($, viewing)

    if (open !== null && (await read($, editing)) && canEdit && Client) {
      const rows = Math.max(6, ((e.props as any).scroll?.bodyRows ?? 24) - 1)
      return (
        <Box flexDirection="column">
          <Text bold>✎ {open.split('/').pop()}</Text>
          <Client key={`edit:${open}`} module="./editor.tsx" props={{ path: open, text: fileText }} height={rows} />
        </Box>
      )
    }

    if (open !== null) {
      const name = open.split('/').pop() ?? open
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button key="back" label="◂ back" hotkey="b" autoFocus onPress={() => void back($, open)} />
            <Button key="back-q" label="q" hotkey="q" plain dimColor onPress={() => void back($, open)} />
            {canEdit && Client && <Button key="edit" label="i edit" hotkey="i" onPress={() => void edit($, true)} />}
            <Button key="mention-open" label="a @" hotkey="a" plain dimColor onPress={() => void mention($, open)} />
            <Text bold> {name}</Text>
          </Box>
          {/\.(md|markdown)$/i.test(name) ? <Markdown text={fileText} /> : <Code source={fileText} path={name} />}
        </Box>
      )
    }

    await load($, root)
    const open_ = await read($, expanded)
    for (const dir of open_) await load($, dir)
    const q = await read($, query)
    if (q && allFiles === null) allFiles = await walkFiles(root, dir => $.fs.list(dir).catch(() => []))
    // With a query the rows are the files it matches; without one, the tree.
    const rows = q
      ? matchPaths(allFiles ?? [], root, q).map(path => ({ path, name: path.slice(root.length + 1), depth: 0, isDir: false, isOpen: false }))
      : flatten(root, children, new Set(open_))
    const Input = 'Input' in ui ? ui.Input : undefined
    rowKeys = rows.map(r => `row:${r.path}`)
    const isInline = e.props.placement === 'inline'
    const bodyRows = (e.props as any).scroll?.bodyRows ?? 24
    treeRows = Math.max(1, bodyRows - (isInline ? 2 : 1) - (Input ? 1 : 0))
    const top = clampTop(await read($, treeTop), rows.length, treeRows)
    const shown = rows.slice(top, top + treeRows)
    const usage = limitsText(await read($, limits))

    return (
      <Box flexDirection="column">
        {!isInline && <Text> </Text>}
        <Box key="head" flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">{root.split('/').pop() || root}</Text>
          <Text dimColor>{usage}</Text>
        </Box>
        {isInline && (
          <Text dimColor>
            inline: {e.viewport?.isFullscreen ? `terminal ${e.viewport.columns} cols, dock needs 110+` : 'not fullscreen, dock needs fullscreen'}
          </Text>
        )}
        {Input && (
          <Input
            key="search"
            placeholder="f: find a file"
            value={q}
            submitLabel="open"
            onInput={value => void update($, query, () => value).then(() => update($, treeTop, () => 0))}
            onSubmit={() => void (rows[0] && !rows[0].isDir ? view($, rows[0].path) : undefined)}
          />
        )}
        {/* Hidden, so their keys stay armed without taking a row: f find, r refresh, a add to the prompt. */}
        <Box display="none">
          <Button key="find" label="find" hotkey="f" onPress={() => void $.ui.focus({ requestId: PANE, key: 'search' }).catch(() => undefined)} />
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => refresh($)} />
          <Button key="mention" label="add" hotkey="a" onPress={() => void (focused.startsWith('row:') ? mention($, focused.slice(4)) : $.ui.toast('Move to a file or folder first'))} />
        </Box>
        {rows.length === 0 && <Text dimColor>{q ? 'no match' : '(empty)'}</Text>}
        {shown.map(r => (
          <Button
            key={`row:${r.path}`}
            label={`${'  '.repeat(r.depth)}${r.isDir ? (r.isOpen ? '▾ ' : '▸ ') : '  '}${r.name}${r.isDir ? '/' : ''}`}
            plain
            dimColor={!r.isDir}
            onPress={() => void (r.isDir ? toggle($, r.path) : view($, r.path))}
          />
        ))}
        {/* Blank rows keep the drawing one row taller than the window both ways (HELD). */}
        {!isInline && Array.from({ length: treeRows - shown.length + 1 }, (_, i) => <Text key={`pad${i}`}> </Text>)}
      </Box>
    )
  })
}
