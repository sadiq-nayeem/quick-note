# QuickNote 🗒

Fast, beautiful, always-there note-taking. Type · Save · Go.

![QuickNote Extension](icons/icon128.png)

A lightweight Chrome extension for quick note-taking with markdown support, reminders, and more.

## Features

### Core
- **Quick Capture** — Jot down notes instantly from the browser popup
- **Markdown Support** — Full markdown rendering with live preview
- **Search** — Search notes with normal, case-sensitive, or regex modes
- **Tags** — Auto-extract `#tags` from your notes for easy filtering
- **Export/Import** — Backup and restore your notes as JSON

### Organization
- **Pinning** — Pin important notes to the top
- **Favorites** — Star notes you'll need forever (separate from pin)
- **Colors** — 7 color options for visual organization
- **Sort Options** — Sort by newest, oldest, A→Z, or color
- **Drag to Reorder** — Manually sort pinned notes

### Advanced
- **Reminders** — Set date/time reminders with Chrome notifications
- **Templates** — Quick-start with Meeting, Todo, or Idea templates
- **Duplicate** — Clone any note instantly
- **Undo Delete** — 5-second undo window after deleting
- **Markdown Preview** — Toggle between raw text and rendered markdown
- **Dark Mode** — Easy theme switching

### Keyboard Shortcuts
- `Alt+N` — New note
- `Alt+S` — Search
- `Esc` — Cancel / Close dialogs
- `Ctrl+Enter` — Save note

## Installation

### From Source
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `quicknote-extension` directory

### Loading After Updates
After making changes to the extension:
1. Go to `chrome://extensions/`
2. Click the reload button 🔄 on the QuickNote card

## Markdown Syntax

QuickNote supports common markdown:

| Syntax | Output |
|--------|--------|
| `# Heading 1` | Large header |
| `## Heading 2` | Medium header |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `- item` | Bullet list |
| `1. item` | Numbered list |
| `- [ ]` | Checkbox |
| `` `code` `` | Inline code |
| `---` | Horizontal line |
| `> quote` | Blockquote |
| `[text](url)` | Link |

## Settings

Click the ⚙ button to access settings:

- **Default Sort Order** — Choose your preferred note sorting
- **Always Show Action Buttons** — Show buttons permanently or on hover only
- **Enable Reminders** — Toggle reminder functionality
- **Theme** — Switch between light and dark mode

## Data Storage

Notes are stored locally using Chrome's `storage.local` API. Your data never leaves your browser unless you explicitly export it.

## Permissions

- **storage** — Save your notes locally
- **alarms** — Schedule reminder notifications
- **notifications** — Show reminder alerts

## Development

Built with vanilla JavaScript, HTML, and CSS. No build step required.

**File Structure:**
- `manifest.json` — Extension configuration
- `popup.html/css/js` — Main popup interface
- `background.js` — Service worker for reminders
- `icons/` — Extension icons

## License

MIT License — feel free to use and modify for your own needs.

---

**Made with ❤️ for quick thinkers**
