# Sidedeck

A Claude Code mod: a keyboard-driven file pane beside the conversation. Browse the project as a
collapsible tree, search it by name, preview Markdown and code, drop `@path` mentions into the
prompt, and edit files with a small nano-style editor, all without leaving the session.

## Install

In a Claude Code terminal session:

```
/plugin install sidedeck --marketplace DDUKHAE/sidedeck
```

Answer `y` to add the marketplace and pick a scope (user scope loads it in every session).
From a shell instead:

```
claude plugin install sidedeck --marketplace DDUKHAE/sidedeck
```

Then type `/sidedeck`. Built and tested on Claude Code 2.1.300.

The pane docks to the right of the conversation in the fullscreen layout at 110 columns or more
(set `"tui": "fullscreen"` in `~/.claude/settings.json`); otherwise it opens above the prompt.

## Tree

| Key | Action |
| --- | --- |
| `ctrl+x` `Tab` | Move the keyboard into the pane |
| `↑` `↓` / `Tab` | Move between rows |
| `Enter` | Fold or unfold a folder, open a file |
| `f` | Search files by name (every word must appear in the path; `Enter` opens the first match) |
| `a` | Add the focused file or folder to the prompt as `@path` |
| `r` | Read the tree again (it also refreshes after Claude runs a tool that changes files) |
| `Esc` | Hand the keyboard back to the prompt |

## File view

| Key | Action |
| --- | --- |
| `b` / `q` | Back to the tree |
| `i` | Edit the file |
| `a` | Add the file to the prompt as `@path` |

Markdown is rendered; other text is shown with syntax highlighting. Binary files, files over
100,000 characters, and files with CRLF line endings or control characters are read-only, so saving
never changes a file in ways you did not type.

## Editor

Click the text once to give it the keyboard (a terminal limit: only a click hands keys to it).

| Key | Action |
| --- | --- |
| Drag / `shift`+arrows | Select |
| `ctrl+s` | Save |
| `ctrl+q` | Close (asks `y`/`n` when there are unsaved changes) |
| `ctrl+x` / `ctrl+k` / `ctrl+v` | Cut / copy / paste (the selection, or the whole line when nothing is selected) |
| `ctrl+b` then a letter | That letter's `ctrl` command, so `ctrl+b c` copies (the terminal keeps `ctrl+c`) |
| `ctrl+f` | Find; `ctrl+f` `Enter` again for the next match |
| `ctrl+g` | Go to line |
| `ctrl+z` / `ctrl+y` | Undo / redo |
| `ctrl+a` / `ctrl+e` | Start / end of line |
| `Esc` | Back to the prompt; your edits stay |

The clipboard is the editor's own; paste text from other apps with the terminal's paste (`cmd+v`).

## Limits

- Search reads up to 5,000 files.
- Changes made outside Claude Code show after `r` or the next file-changing tool.
- No horizontal wrapping in the editor; the view slides with the cursor.

## Develop

```
claude --plugin-dir <this folder>
claude plugin validate <this folder>
claude plugin test <this folder>
```

## License

MIT
