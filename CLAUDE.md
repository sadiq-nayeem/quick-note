# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QuickNote is a Chromium browser extension (Manifest V3) for fast, lightweight note-taking. The extension has no build process — it's vanilla HTML/CSS/JavaScript that runs directly in the browser.

## Development

### Loading the Extension
1. Open Chrome/Edge and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this directory

### After Changes
Simply click the reload button on the extension card at `chrome://extensions/`. No build command is needed.

## Architecture

### File Structure
- `manifest.json` - Extension configuration (permissions, popup declaration)
- `popup.html` - Single-page UI with three views: New, Search, All Notes
- `popup.css` - All styling including light/dark theme via `[data-theme="dark"]`
- `popup.js` - All application logic (state, storage, DOM manipulation)

### Application State
- `notes` array stored in `chrome.storage.local` under key `qn_notes`
- Theme preference stored under key `qn_theme` ('light' or 'dark')
- Each note has: `id`, `title`, `body`, `comment`, `tags`, `color` (0-6), `pinned`, `createdAt`, `updatedAt`

### Key Patterns
- **View Switching**: `showView(name)` toggles visibility of `#viewNew`, `#viewSearch`, `#viewList`
- **Card Rendering**: `buildCard(note, query, mode)` creates note cards with optional search highlighting
- **Search Modes**: Normal (case-insensitive), Strict (case-sensitive), Regex
- **Note Colors**: 7 color variants defined in CSS as `.nc-0` through `.nc-6`
- **Tags**: Auto-extracted from note body using `#[\w\u00C0-\u024F]+` regex pattern

### Storage API
Uses Chrome's `chrome.storage.local` which is asynchronous. All storage operations return promises or use callbacks.
