import type { ClientModule } from 'claude-code'

import { fresh, isDirty, range, step, textOf } from './nano'
import type { Ed } from './nano'

type Props = { path: string; text: string }
type S = Ed & { top: number }

const FOOTER = 2 // the status line and the key help
const HELP = 'drag/shift+arrows select  ^S save  ^Q close  ^X cut  ^K or ^B c copy  ^V paste  ^F find  ^G line  ^Z undo  Esc prompt'

// The window top that keeps `row` on screen.
const follow = (row: number, top: number, rows: number) => (row < top ? row : row >= top + rows ? row - rows + 1 : top)

const Editor: ClientModule<Props, S> = (props, surface) => {
  const { Box, Text } = surface.elements
  const bodyRows = Math.max(1, surface.rows - FOOTER)
  const name = props.path.split('/').pop() ?? props.path

  if (surface.state === undefined) {
    surface.setState({ ...fresh(props.text), top: 0 })

    surface.onKey(key => {
      const st = surface.state
      if (!st) return
      const { st: next, effect } = step(st, key)
      let out: S = { ...next, top: follow(next.row, st.top, Math.max(1, surface.rows - FOOTER)) }
      if (effect === 'save' || effect === 'save-close') {
        surface.post({ type: 'save', text: textOf(out), close: effect === 'save-close' })
        out = { ...out, saved: textOf(out), msg: `wrote ${out.lines.length} lines` }
      }
      if (effect === 'close') surface.post({ type: 'close' })
      surface.setState(out)
    })

    // A click puts the cursor there; dragging with the button held selects from there.
    // The surface keeps the pointer from the press to the release, so a drag past the edges still arrives.
    surface.onPointer(ev => {
      const st = surface.state
      if (!st || ev.button !== 'left' || (ev.type !== 'down' && ev.type !== 'move' && ev.type !== 'up')) return
      const rows = Math.max(1, surface.rows - FOOTER)
      if (ev.type === 'down' && ev.y >= rows) return
      const gutter = String(st.lines.length).length + 1
      const row = Math.max(0, Math.min(st.lines.length - 1, st.top + ev.y))
      const col = Math.max(0, Math.min(st.lines[row].length, ev.x - gutter))
      if (ev.type === 'down') surface.setState({ ...st, row, col, sel: { row, col } })
      else if (ev.type === 'move') surface.setState({ ...st, row, col, top: follow(row, st.top, rows) })
      else if (st.sel && st.sel.row === row && st.sel.col === col) surface.setState({ ...st, sel: null })
    })
  }

  const st = surface.state ?? { ...fresh(props.text), top: 0 }
  const gutter = String(st.lines.length).length
  const cols = Math.max(4, surface.columns - gutter - 1)
  // ponytail: one horizontal offset for the whole window, set by the cursor; wrap long lines if they get common
  const left = Math.max(0, st.col - cols + 1)

  const span = range(st)
  const lines = st.lines.slice(st.top, st.top + bodyRows).map((line, i) => {
    const row = st.top + i
    const shown = line.slice(left, left + cols)
    const num = <Text dimColor>{String(row + 1).padStart(gutter)} </Text>
    // The part of this line inside the selection, in shown columns; a selected line break shows as one cell.
    let [sa, sb] = [0, 0]
    if (span && row >= span[0].row && row <= span[1].row) {
      sa = (row === span[0].row ? span[0].col : 0) - left
      sb = (row === span[1].row ? span[1].col : line.length + 1) - left
    }
    const cursor = row === st.row ? st.col - left : -1
    // Runs of cells that look the same: plain, selected, or the cursor.
    const look = (c: number) => (c === cursor ? 'cursor' : c >= sa && c < sb ? 'sel' : 'plain')
    const cells = Math.max(shown.length, cursor + 1, Math.min(sb, cols))
    const runs: { look: string; text: string }[] = []
    for (let c = 0; c < cells; c++) {
      const ch = shown[c] ?? ' '
      const last = runs[runs.length - 1]
      if (last && last.look === look(c)) last.text += ch
      else runs.push({ look: look(c), text: ch })
    }
    return (
      <Text key={String(row)}>
        {num}
        {runs.map(r => (r.look === 'plain' ? r.text : <Text inverse={r.look === 'cursor'} backgroundColor={r.look === 'sel' ? 'blue' : undefined}>{r.text}</Text>))}
      </Text>
    )
  })

  const status = st.ask?.kind === 'close'
    ? 'Save changes? (y)es  (n)o  any other key cancels'
    : st.ask
      ? `${st.ask.kind === 'find' ? 'Search' : 'Go to line'}: ${st.ask.text}`
      : `${name}${isDirty(st) ? ' ●' : ''}  ${st.row + 1}:${st.col + 1}  ${st.msg || 'click the text to type'}`

  return (
    <Box flexDirection="column">
      {lines}
      {Array.from({ length: Math.max(0, bodyRows - lines.length) }, (_, i) => <Text key={`~${i}`}> </Text>)}
      <Text inverse={st.ask !== null} bold wrap="truncate-end">{status}</Text>
      <Text dimColor wrap="truncate-end">{HELP}</Text>
    </Box>
  )
}

export default Editor
