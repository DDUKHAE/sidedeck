export type Entry = { name: string; kind: 'file' | 'dir' | 'other' }
export type Row = { path: string; name: string; depth: number; isDir: boolean; isOpen: boolean }

const HIDDEN = new Set(['.git', 'node_modules', '.DS_Store'])

export function sortEntries(list: readonly Entry[]): Entry[] {
  return list
    .filter(e => !HIDDEN.has(e.name))
    .sort((a, b) => (a.kind === 'dir') !== (b.kind === 'dir') ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name))
}

// Depth-first rows of the open folders; a folder not listed yet shows no children.
export function flatten(root: string, children: ReadonlyMap<string, readonly Entry[]>, expanded: ReadonlySet<string>, max = 400): Row[] {
  const out: Row[] = []
  const walk = (dir: string, depth: number) => {
    for (const e of children.get(dir) ?? []) {
      if (out.length >= max) return
      const path = `${dir}/${e.name}`
      const isDir = e.kind === 'dir'
      const isOpen = isDir && expanded.has(path)
      out.push({ path, name: e.name, depth, isDir, isOpen })
      if (isOpen) walk(path, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

// Every file under root, breadth first, for search; folders the tree hides are skipped.
// ponytail: a capped walk read once and kept until a tool changes files; use `git ls-files` if big repos hit the cap
export async function walkFiles(root: string, list: (dir: string) => Promise<readonly Entry[]>, max = 5000): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length > 0 && files.length < max) {
    const dir = queue.shift()!
    for (const e of sortEntries(await list(dir))) {
      const path = `${dir}/${e.name}`
      if (e.kind === 'dir') queue.push(path)
      else if (e.kind === 'file') files.push(path)
    }
  }
  return files.slice(0, max)
}

// Paths whose part under root holds every word of the query, shortest first.
export function matchPaths(paths: readonly string[], root: string, query: string, max = 50): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return paths
    .filter(p => { const rel = p.slice(root.length + 1).toLowerCase(); return words.every(w => rel.includes(w)) })
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, max)
}

// The prompt's @-mention of a path, relative to root where it is under it; null for a name
// a quote or a control character could turn into other prompt text.
export function mentionOf(path: string, root: string): string | null {
  const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  if (/["\u0000-\u001f\u007f]/.test(rel)) return null
  return /\s/.test(rel) ? `@"${rel}" ` : `@${rel} `
}
