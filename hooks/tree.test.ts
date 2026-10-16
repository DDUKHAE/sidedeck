import { test, expect } from 'claude-code/testing'
import { flatten, sortEntries } from './tree'

test('dirs first, hidden dropped, only open folders expand', () => {
  const kids = new Map([
    ['/r', sortEntries([{ name: 'b.txt', kind: 'file' }, { name: 'src', kind: 'dir' }, { name: '.git', kind: 'dir' }, { name: 'docs', kind: 'dir' }])],
    ['/r/src', [{ name: 'a.ts', kind: 'file' as const }]],
  ])
  expect(flatten('/r', kids, new Set()).map(r => r.name)).toEqual(['docs', 'src', 'b.txt'])
  const open = flatten('/r', kids, new Set(['/r/src']))
  expect(open.map(r => `${r.depth}${r.name}`)).toEqual(['0docs', '0src', '1a.ts', '0b.txt'])
  expect(open[1].isOpen).toBe(true)
})

import { follow } from './register'
test('window follows the focused row', () => {
  expect(follow(3, 0, 10)).toBe(0)
  expect(follow(10, 0, 10)).toBe(1)
  expect(follow(2, 5, 10)).toBe(2)
})

import { displayable } from './register'
test('file text is made drawable', () => {
  expect(displayable('a\r\nb\u001bc')).toBe('a\nbc')
  expect(displayable('x\u0000y')).toBe('(binary file, not shown)')
  expect(displayable('z'.repeat(100_001)).endsWith('characters)')).toBe(true)
})

import { clampTop, limitsText } from './register'
test('tree window and limits text', () => {
  expect(clampTop(30, 40, 20)).toBe(20)
  expect(clampTop(-3, 40, 20)).toBe(0)
  expect(clampTop(5, 10, 20)).toBe(0)
  expect(limitsText({ fiveHour: 23.4, week: 60 })).toBe('5h 77% · 7d 40% left')
  expect(limitsText({ fiveHour: null, week: null })).toBe('')
})

import { walkFiles, matchPaths, mentionOf } from './tree'
test('search walks files and matches every word', async () => {
  const fs: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
    '/r': [{ name: 'src', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }, { name: 'README.md', kind: 'file' }],
    '/r/src': [{ name: 'user model.rb', kind: 'file' }, { name: 'app.ts', kind: 'file' }],
  }
  const files = await walkFiles('/r', async d => fs[d] ?? [])
  expect(files).toEqual(['/r/README.md', '/r/src/app.ts', '/r/src/user model.rb'])
  expect(matchPaths(files, '/r', 'src model')).toEqual(['/r/src/user model.rb'])
  expect(matchPaths(files, '/r', 'READ')).toEqual(['/r/README.md'])
  expect(matchPaths(files, '/r', '  ')).toEqual([])
})

test('mentions are relative and quoted when they hold a space', () => {
  expect(mentionOf('/r/src/app.ts', '/r')).toBe('@src/app.ts ')
  expect(mentionOf('/r/a b.md', '/r')).toBe('@"a b.md" ')
  expect(mentionOf('/r/x"y', '/r')).toBe(null)
})
