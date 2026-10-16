// A small modeless editor: its whole behaviour as one pure step from (state, key) to state.

type Snap = { lines: string[]; row: number; col: number }
export type Pos = { row: number; col: number }
// What cut or copy took: a span of text, or a whole line when nothing was selected.
type Clip = { text: string; isLine: boolean }

// What the bottom line is asking for, if anything.
export type Ask = null | { kind: 'find' | 'line'; text: string } | { kind: 'close' }

export type Ed = {
  lines: string[]
  row: number
  col: number
  sel: Pos | null // the selection's fixed end; the cursor is the other
  ask: Ask
  clip: Clip | null
  search: string
  undo: Snap[]
  redo: Snap[]
  saved: string // the text as last written
  msg: string
  prefix: boolean // ctrl+b was pressed: the next key names a command, as in tmux
}

export type Key = { key: string; ctrl?: boolean; shift?: boolean; meta?: boolean }
export type Effect = 'save' | 'close' | 'save-close' | null

const HISTORY = 200
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export const textOf = (st: Ed) => st.lines.join('\n')
export const isDirty = (st: Ed) => textOf(st) !== st.saved

export function fresh(text: string): Ed {
  return { lines: text.split('\n'), row: 0, col: 0, sel: null, ask: null, clip: null, search: '', undo: [], redo: [], saved: text, msg: '', prefix: false }
}

const fit = (st: Ed): Ed => {
  const row = clamp(st.row, 0, st.lines.length - 1)
  return { ...st, row, col: clamp(st.col, 0, st.lines[row].length) }
}

// Every change goes through here, so each one is one undo step.
// ponytail: one step per key, so undoing a typed word takes a key per letter; group runs of typing if that annoys
const change = (st: Ed, lines: string[], row: number, col: number): Ed =>
  fit({ ...st, lines, row, col, sel: null, undo: [...st.undo, { lines: st.lines, row: st.row, col: st.col }].slice(-HISTORY), redo: [] })

const setLine = (lines: string[], row: number, text: string) => lines.map((l, i) => (i === row ? text : l))
const before = (a: Pos, b: Pos) => a.row < b.row || (a.row === b.row && a.col < b.col)

// The selection as [start, end), or null when there is none or it is empty.
export function range(st: Ed): [Pos, Pos] | null {
  if (!st.sel) return null
  const cur = { row: st.row, col: st.col }
  if (st.sel.row === cur.row && st.sel.col === cur.col) return null
  return before(st.sel, cur) ? [st.sel, cur] : [cur, st.sel]
}

function spanText(lines: string[], [a, b]: [Pos, Pos]): string {
  if (a.row === b.row) return lines[a.row].slice(a.col, b.col)
  return [lines[a.row].slice(a.col), ...lines.slice(a.row + 1, b.row), lines[b.row].slice(0, b.col)].join('\n')
}

// Puts `text` in place of [a, b) and leaves the cursor after it.
function replace(st: Ed, [a, b]: [Pos, Pos], text: string): Ed {
  const merged = st.lines[a.row].slice(0, a.col) + text + st.lines[b.row].slice(b.col)
  const lines = [...st.lines.slice(0, a.row), ...merged.split('\n'), ...st.lines.slice(b.row + 1)]
  const typed = text.split('\n')
  const row = a.row + typed.length - 1
  const col = (typed.length === 1 ? a.col : 0) + typed[typed.length - 1].length
  return change(st, lines, row, col)
}

function find(st: Ed): Ed {
  if (!st.search) return st
  const n = st.lines.length
  for (let k = 0; k <= n; k++) {
    const row = (st.row + k) % n
    const at = st.lines[row].indexOf(st.search, k === 0 ? st.col + 1 : 0)
    if (at !== -1) return { ...st, row, col: at, sel: null }
  }
  return { ...st, msg: `"${st.search}" not found` }
}

function move(st: Ed, key: string): Ed {
  const line = st.lines[st.row]
  switch (key) {
    case 'left': return st.col > 0 ? { ...st, col: st.col - 1 } : st.row > 0 ? { ...st, row: st.row - 1, col: st.lines[st.row - 1].length } : st
    case 'right': return st.col < line.length ? { ...st, col: st.col + 1 } : st.row < st.lines.length - 1 ? { ...st, row: st.row + 1, col: 0 } : st
    case 'up': return fit({ ...st, row: st.row - 1 })
    case 'down': return fit({ ...st, row: st.row + 1 })
    case 'pageup': return fit({ ...st, row: st.row - 20 })
    case 'pagedown': return fit({ ...st, row: st.row + 20 })
    case 'home': return { ...st, col: 0 }
    case 'end': return { ...st, col: line.length }
    default: return st
  }
}
const MOVES = new Set(['left', 'right', 'up', 'down', 'pageup', 'pagedown', 'home', 'end'])

const norm = (k: Key): Key => (k.key === 'space' ? { ...k, key: ' ' } : k)
const isChar = (k: Key) => !k.ctrl && !k.meta && [...k.key].length === 1

function answer(st: Ed, k: Key): { st: Ed; effect: Effect } {
  const ask = st.ask!
  if (ask.kind === 'close') {
    if (k.key === 'y') return { st: { ...st, ask: null }, effect: 'save-close' }
    if (k.key === 'n') return { st: { ...st, ask: null }, effect: 'close' }
    return { st: { ...st, ask: null, msg: 'cancelled' }, effect: null }
  }
  if (k.key === 'return') {
    const done = { ...st, ask: null }
    if (ask.kind === 'line') return { st: /^\d+$/.test(ask.text) ? fit({ ...done, row: Number(ask.text) - 1, col: 0, sel: null }) : done, effect: null }
    return { st: find({ ...done, search: ask.text || st.search }), effect: null }
  }
  if (k.key === 'backspace') return { st: { ...st, ask: { ...ask, text: ask.text.slice(0, -1) } }, effect: null }
  if (k.ctrl && (k.key === 'f' || k.key === 'g')) return { st: { ...st, ask: null, msg: 'cancelled' }, effect: null }
  if (isChar(k)) return { st: { ...st, ask: { ...ask, text: ask.text + k.key } }, effect: null }
  return { st, effect: null }
}

function ctrlKey(st: Ed, key: string): { st: Ed; effect: Effect } {
  const line = st.lines[st.row]
  const span = range(st)
  const here: Pos = { row: st.row, col: st.col }
  switch (key) {
    case 's': return { st: { ...st, msg: 'saved' }, effect: 'save' }
    case 'q': return isDirty(st) ? { st: { ...st, ask: { kind: 'close' } }, effect: null } : { st, effect: 'close' }
    // Copy is ctrl+k: the terminal keeps ctrl+c for itself.
    case 'k': case 'c': return { st: { ...st, clip: span ? { text: spanText(st.lines, span), isLine: false } : { text: line, isLine: true }, msg: span ? 'copied' : 'copied 1 line' }, effect: null }
    case 'x': {
      if (span) return { st: { ...replace(st, span, ''), clip: { text: spanText(st.lines, span), isLine: false }, msg: 'cut' }, effect: null }
      const lines = st.lines.length === 1 ? [''] : st.lines.filter((_, i) => i !== st.row)
      return { st: { ...change(st, lines, st.row, 0), clip: { text: line, isLine: true }, msg: 'cut 1 line' }, effect: null }
    }
    case 'v': {
      if (!st.clip) return { st: { ...st, msg: 'nothing to paste' }, effect: null }
      if (st.clip.isLine && !span) return { st: change(st, [...st.lines.slice(0, st.row), st.clip.text, ...st.lines.slice(st.row)], st.row + 1, st.col), effect: null }
      return { st: replace(st, span ?? [here, here], st.clip.text), effect: null }
    }
    case 'z': {
      const last = st.undo.at(-1)
      if (!last) return { st: { ...st, msg: 'nothing to undo' }, effect: null }
      return { st: fit({ ...st, ...last, sel: null, undo: st.undo.slice(0, -1), redo: [...st.redo, { lines: st.lines, row: st.row, col: st.col }] }), effect: null }
    }
    case 'y': {
      const last = st.redo.at(-1)
      if (!last) return { st: { ...st, msg: 'nothing to redo' }, effect: null }
      return { st: fit({ ...st, ...last, sel: null, redo: st.redo.slice(0, -1), undo: [...st.undo, { lines: st.lines, row: st.row, col: st.col }] }), effect: null }
    }
    case 'f': return { st: { ...st, ask: { kind: 'find', text: '' } }, effect: null }
    case 'g': return { st: { ...st, ask: { kind: 'line', text: '' } }, effect: null }
    case 'a': return { st: { ...st, col: 0, sel: null }, effect: null }
    case 'e': return { st: { ...st, col: line.length, sel: null }, effect: null }
    // A ctrl key with no use here says so, to tell a key the terminal swallowed from one that did nothing.
    default: return { st: { ...st, msg: `ctrl+${key}: no action` }, effect: null }
  }
}

export const PREFIX = 'b'

export function step(prev: Ed, raw: Key): { st: Ed; effect: Effect } {
  const k = norm(raw)
  const st: Ed = { ...prev, msg: '', prefix: false }
  if (st.ask) return answer(st, k)
  // ctrl+b, then a letter: the letter's ctrl command, so ctrl+c (the terminal's) is reached as ctrl+b c.
  if (prev.prefix) return [...k.key].length === 1 ? ctrlKey(st, k.key.toLowerCase()) : { st: { ...st, msg: 'cancelled' }, effect: null }
  if (k.ctrl && k.key === PREFIX) return { st: { ...st, prefix: true, msg: '^B -' }, effect: null }
  if (k.ctrl) return ctrlKey(st, k.key)
  const none = { st, effect: null as Effect }

  // shift+arrows grow the selection; a plain move drops it.
  if (MOVES.has(k.key)) return { st: { ...move(st, k.key), sel: k.shift ? (st.sel ?? { row: st.row, col: st.col }) : null }, effect: null }

  // With a selection, typing replaces it and Backspace or Delete removes it.
  const span = range(st)
  const typed = k.key === 'return' ? null : k.key === 'tab' ? '    ' : isChar(k) ? k.key : null
  if (span) {
    if (k.key === 'backspace' || k.key === 'delete') return { st: replace(st, span, ''), effect: null }
    if (k.key === 'return') return { st: replace(st, span, '\n'), effect: null }
    return typed === null ? none : { st: replace(st, span, typed), effect: null }
  }

  const line = st.lines[st.row]
  switch (k.key) {
    case 'return': {
      const indent = /^\s*/.exec(line)![0]
      const lines = [...st.lines.slice(0, st.row), line.slice(0, st.col), indent + line.slice(st.col), ...st.lines.slice(st.row + 1)]
      return { st: change(st, lines, st.row + 1, indent.length), effect: null }
    }
    case 'backspace': {
      if (st.col > 0) return { st: change(st, setLine(st.lines, st.row, line.slice(0, st.col - 1) + line.slice(st.col)), st.row, st.col - 1), effect: null }
      if (st.row === 0) return none
      const above = st.lines[st.row - 1]
      return { st: change(st, [...st.lines.slice(0, st.row - 1), above + line, ...st.lines.slice(st.row + 1)], st.row - 1, above.length), effect: null }
    }
    case 'delete': {
      if (st.col < line.length) return { st: change(st, setLine(st.lines, st.row, line.slice(0, st.col) + line.slice(st.col + 1)), st.row, st.col), effect: null }
      if (st.row === st.lines.length - 1) return none
      return { st: change(st, [...st.lines.slice(0, st.row), line + st.lines[st.row + 1], ...st.lines.slice(st.row + 2)], st.row, st.col), effect: null }
    }
  }
  if (typed === null) return none
  return { st: change(st, setLine(st.lines, st.row, line.slice(0, st.col) + typed + line.slice(st.col)), st.row, st.col + typed.length), effect: null }
}
