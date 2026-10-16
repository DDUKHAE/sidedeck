import { test, expect } from 'claude-code/testing'
import { fresh, step, textOf, isDirty } from './nano'
import type { Ed, Key } from './nano'

const run = (st: Ed, ...ks: (string | Key)[]) => {
  const effects: string[] = []
  for (const k of ks) {
    const r = step(st, typeof k === 'string' ? { key: k } : k)
    st = r.st
    if (r.effect) effects.push(r.effect)
  }
  return { st, effects }
}
const ctrl = (key: string): Key => ({ key, ctrl: true })
const shift = (key: string): Key => ({ key, shift: true })
const type = (s: string) => [...s]

test('typing, undo, redo', () => {
  let { st } = run(fresh('ab'), 'end', ...type('cd'))
  expect(textOf(st)).toBe('abcd')
  expect(isDirty(st)).toBe(true)
  st = run(st, ctrl('z')).st
  expect(textOf(st)).toBe('abc')
  st = run(st, ctrl('y')).st
  expect(textOf(st)).toBe('abcd')
})

test('without a selection: cut, copy, paste whole lines', () => {
  let { st } = run(fresh('one\ntwo\nthree'), ctrl('x'))
  expect(st.lines).toEqual(['two', 'three'])
  st = run(st, 'down', ctrl('v')).st
  expect(st.lines).toEqual(['two', 'one', 'three'])
  st = run(st, ctrl('k'), ctrl('v')).st
  expect(st.lines).toEqual(['two', 'one', 'three', 'three'])
})

test('shift+arrows select; copy and paste the span', () => {
  let { st } = run(fresh('hello world'), shift('right'), shift('right'), shift('right'), shift('right'), shift('right'), ctrl('k'))
  expect(st.clip).toEqual({ text: 'hello', isLine: false })
  st = run(st, 'end', ctrl('v')).st
  expect(textOf(st)).toBe('hello worldhello')
})

test('cut across lines, typing replaces a selection', () => {
  let { st } = run(fresh('ab\ncd'), 'right', shift('down'), ctrl('x'))
  expect(textOf(st)).toBe('ad')
  expect(st.clip).toEqual({ text: 'b\nc', isLine: false })
  st = run(st, shift('right'), 'Z').st
  expect(textOf(st)).toBe('aZ')
})

test('a selection set by the mouse (sel + cursor) works the same', () => {
  const st = { ...fresh('abcdef'), sel: { row: 0, col: 1 }, col: 4 }
  expect(textOf(run(st, 'backspace').st)).toBe('aef')
})

test('return keeps indent, backspace joins', () => {
  let { st } = run(fresh('  ab'), 'end', 'return', 'c')
  expect(st.lines).toEqual(['  ab', '  c'])
  st = run(st, 'backspace', 'backspace', 'backspace', 'backspace').st
  expect(st.lines).toEqual(['  ab'])
})

test('save, close asks when dirty', () => {
  const r = run(run(fresh('a'), 'x').st, ctrl('q'))
  expect(r.effects).toEqual([])
  expect(r.st.ask).toEqual({ kind: 'close' })
  expect(run(r.st, 'y').effects).toEqual(['save-close'])
  expect(run(r.st, 'n').effects).toEqual(['close'])
  expect(run(r.st, 'c').effects).toEqual([])
  expect(run(fresh('a'), ctrl('q')).effects).toEqual(['close'])
  expect(run(fresh('a'), ctrl('s')).effects).toEqual(['save'])
})

test('find and go to line', () => {
  let { st } = run(fresh('x cat\ny cat'), ctrl('f'), ...type('cat'), 'return')
  expect([st.row, st.col]).toEqual([0, 2])
  st = run(st, ctrl('f'), 'return').st
  expect([st.row, st.col]).toEqual([1, 2])
  st = run(st, ctrl('g'), '1', 'return').st
  expect(st.row).toBe(0)
})

test('an unused ctrl key says so', () => {
  expect(run(fresh(''), ctrl('j')).st.msg).toBe('ctrl+j: no action')
})

test('ctrl+b then a letter runs that letter\'s ctrl command', () => {
  let { st } = run(fresh('one\ntwo'), ctrl('b'), 'c')
  expect(st.clip).toEqual({ text: 'one', isLine: true })
  st = run(st, ctrl('b'), 'x').st
  expect(st.lines).toEqual(['two'])
  st = run(st, ctrl('b'), 'v').st
  expect(st.lines).toEqual(['one', 'two'])
  expect(run(st, ctrl('b'), 's').effects).toEqual(['save'])
  expect(textOf(run(st, ctrl('b'), 'right', 'a').st)).toBe('one\natwo')
})
