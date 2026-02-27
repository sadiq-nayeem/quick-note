/* ─────────────────────────────────────────────
   QuickNote — popup.js
   ───────────────────────────────────────────── */

// ── STATE ──────────────────────────────────────
let notes      = [];
let editingId  = null;
let deleteId   = null;
let searchMode = 'normal';  // 'normal' | 'strict' | 'regex'
let currentView = 'new';    // 'new' | 'search' | 'list'
let sortMode   = 'newest';  // 'newest' | 'oldest' | 'az' | 'color'
let activeTag  = null;      // currently filtered tag
let selectedColor = null;   // manually selected color
let pendingDelete = null;   // for undo delete
let undoTimer = null;       // undo timeout timer

const COLORS = 7; // 0..6 — matches CSS .nc-0 … .nc-6
const MAX_BODY = 5000; // character limit for warning

// ── TEMPLATES ────────────────────────────────────
const TEMPLATES = {
  meeting: {
    title: 'Meeting Notes',
    body: 'Date: \nAttendees: \n\nAgenda:\n- \n- \n\nNotes:\n\nAction Items:\n- [ ] '
  },
  todo: {
    title: 'Todo List',
    body: '- [ ] \n- [ ] \n- [ ] \n- [ ] '
  },
  idea: {
    title: 'Quick Idea',
    body: 'Idea: \n\nWhy: \n\nNext steps: '
  }
};

// ── UTILS ──────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function randColor() {
  return Math.floor(Math.random() * COLORS);
}

function extractTags(text) {
  const matches = text.match(/#[\w\u00C0-\u024F]+/g);
  return matches ? [...new Set(matches)] : [];
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60)  return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fullDate(ts) {
  return new Date(ts).toLocaleString();
}

function countWordsChars(str) {
  const chars = str.length;
  const words = str.trim() === '' ? 0 : str.trim().split(/\s+/).length;
  return `${chars} char${chars !== 1 ? 's' : ''} · ${words} word${words !== 1 ? 's' : ''}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── MARKDOWN PARSER ───────────────────────────────
function parseMarkdown(text) {
  if (!text) return '';

  let html = text;

  // Escape HTML first
  html = escapeHtml(html);

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

  // Bold and Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Blockquotes
  html = html.replace(/^&gt; (.*$)/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^\*\*\*$/gm, '<hr>');

  // Checkboxes (todo items)
  html = html.replace(/^- \[x\] (.*)$/gm, '<div><input type="checkbox" checked disabled> $1</div>');
  html = html.replace(/^- \[ \] (.*)$/gm, '<div><input type="checkbox" disabled> $1</div>');

  // Unordered lists
  html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Ordered lists
  html = html.replace(/^\d+\. (.*)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>.*<\/oli>)/s, '<ol>$1</ol>'.replace(/oli/g, 'li'));
  html = html.replace(/<\/ol>\s*<ol>/g, '');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Line breaks to <br>, but not in block elements
  html = html.replace(/\n/g, '<br>');

  // Remove <br> inside block elements
  html = html.replace(/<\/?(h[1-3]|pre|code|ul|ol|li|blockquote|hr|div)>/g, '\n$&');
  html = html.replace(/<br>(\s*<\/?(h[1-3]|pre|code|ul|ol|li|blockquote|hr|div)>)/g, '$1');
  html = html.replace(/(<\/?(?:h[1-3]|pre|code|ul|ol|li|blockquote|hr|div)>)<br>/g, '$1');

  return html;
}

function highlight(text, query, mode) {
  if (!query) return escapeHtml(text);
  let pattern;
  try {
    if (mode === 'regex')  pattern = new RegExp(`(${query})`, 'g');
    else if (mode === 'strict') pattern = new RegExp(`(${escapeRegex(query)})`, 'g');
    else                   pattern = new RegExp(`(${escapeRegex(query)})`, 'gi');
  } catch { return escapeHtml(text); }
  return escapeHtml(text).replace(pattern, '<mark>$1</mark>');
}

function matchesSearch(note, query, mode) {
  if (!query) return true;
  const targets = [note.title, note.body, note.comment, ...(note.tags || [])].join(' ');
  try {
    if (mode === 'regex')  return new RegExp(query).test(targets);
    if (mode === 'strict') return targets.includes(query);
    return targets.toLowerCase().includes(query.toLowerCase());
  } catch { return false; }
}

// ── STORAGE ────────────────────────────────────
function loadNotes() {
  return new Promise(resolve => {
    chrome.storage.local.get(['qn_notes', 'qn_theme'], data => {
      notes = data.qn_notes || [];
      if (data.qn_theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeBtn.textContent = '☀';
      }
      resolve();
    });
  });
}

function saveNotes() {
  chrome.storage.local.set({ qn_notes: notes });
  updateNoteCount();
}

// ── DOM REFS ────────────────────────────────────
const themeBtn       = document.getElementById('themeBtn');
const importBtn      = document.getElementById('importBtn');
const exportBtn      = document.getElementById('exportBtn');
const importInput    = document.getElementById('importInput');
const noteCountEl    = document.getElementById('noteCount');

const btnNew         = document.getElementById('btnNew');
const btnSearch      = document.getElementById('btnSearch');
const btnList        = document.getElementById('btnList');

const viewNew        = document.getElementById('viewNew');
const viewSearch     = document.getElementById('viewSearch');
const viewList       = document.getElementById('viewList');
const sortBar        = document.getElementById('sortBar');
const sortBtns       = document.querySelectorAll('.sort-btn');
const tagSidebar     = document.getElementById('tagSidebar');
const tagList        = document.getElementById('tagList');

const noteTitle      = document.getElementById('noteTitle');
const noteBody       = document.getElementById('noteBody');
const noteComment    = document.getElementById('noteComment');
const charCount      = document.getElementById('charCount');
const btnSave        = document.getElementById('btnSave');
const btnCancelEdit  = document.getElementById('btnCancelEdit');

const btnMarkdownToggle = document.getElementById('btnMarkdownToggle');
const markdownPreview = document.getElementById('markdownPreview');

const searchInput    = document.getElementById('searchInput');
const modeBtns       = document.querySelectorAll('.mode-btn');
const searchResults  = document.getElementById('searchResults');
const searchError    = document.getElementById('searchError');

const allNotes       = document.getElementById('allNotes');
const emptyState     = document.getElementById('emptyState');

const toast          = document.getElementById('toast');

const overlay        = document.getElementById('overlay');
const btnCancelDelete = document.getElementById('btnCancelDelete');
const btnConfirmDelete = document.getElementById('btnConfirmDelete');

const viewModalOverlay = document.getElementById('viewModalOverlay');
const viewModalTitle = document.getElementById('viewModalTitle');
const viewModalMeta = document.getElementById('viewModalMeta');
const viewModalBody = document.getElementById('viewModalBody');
const btnCloseViewModal = document.getElementById('btnCloseViewModal');
const btnViewModalClose = document.getElementById('btnViewModalClose');
const btnViewModalEdit = document.getElementById('btnViewModalEdit');
let currentViewNoteId = null;

const templateBtns   = document.querySelectorAll('.template-btn');
const colorBtns      = document.querySelectorAll('.color-btn');
const btnRandomColor = document.getElementById('btnRandomColor');
const toastMsg       = document.getElementById('toastMsg');
const toastUndo      = document.getElementById('toastUndo');

// ── THEME ───────────────────────────────────────
themeBtn.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    themeBtn.textContent = '🌙';
    chrome.storage.local.set({ qn_theme: 'light' });
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeBtn.textContent = '☀';
    chrome.storage.local.set({ qn_theme: 'dark' });
  }
});

// ── KEYBOARD SHORTCUTS ──────────────────────────
document.addEventListener('keydown', e => {
  // Alt+N: New note
  if (e.altKey && e.key === 'n') {
    e.preventDefault();
    editingId = null;
    showView('new');
    return;
  }
  // Alt+S: Search
  if (e.altKey && e.key === 's') {
    e.preventDefault();
    showView('search');
    return;
  }
  // Esc: Cancel dialog or exit edit mode
  if (e.key === 'Escape') {
    if (!overlay.classList.contains('hidden')) {
      deleteId = null;
      overlay.classList.add('hidden');
    } else if (editingId) {
      resetForm();
      showView('list');
    }
    return;
  }
});

// ── TEMPLATES ────────────────────────────────────
templateBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    templateBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const template = btn.dataset.template;
    if (TEMPLATES[template]) {
      noteTitle.value = TEMPLATES[template].title;
      noteBody.value = TEMPLATES[template].body;
      charCount.textContent = countWordsChars(TEMPLATES[template].body);
      noteBody.focus();
    } else if (template === '') {
      // Blank template - clear form
      noteTitle.value = '';
      noteBody.value = '';
      charCount.textContent = '0 chars · 0 words';
    }
  });
});

// ── COLOR PICKER ────────────────────────────────
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.remove('active'));
    btnRandomColor.classList.remove('active');
    btn.classList.add('active');
    selectedColor = parseInt(btn.dataset.color);
  });
});

btnRandomColor.addEventListener('click', () => {
  colorBtns.forEach(b => b.classList.remove('active'));
  btnRandomColor.classList.add('active');
  selectedColor = null; // null means random
});

// ── EXPORT ──────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `quicknotes-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📦 Notes exported!');
});

// ── IMPORT ──────────────────────────────────────
importBtn.addEventListener('click', () => importInput.click());

importInput.addEventListener('change', () => {
  const file = importInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      // Merge with existing notes (avoid duplicates by ID)
      let added = 0;
      imported.forEach(note => {
        if (note.id && !notes.find(n => n.id === note.id)) {
          notes.push(note);
          added++;
        }
      });

      saveNotes();
      if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
      showToast(`📥 Imported ${added} note${added !== 1 ? 's' : ''}!`);
    } catch {
      showToast('❌ Import failed: invalid file');
    }
    importInput.value = ''; // reset
  };
  reader.readAsText(file);
});

// ── NOTE COUNT ──────────────────────────────────
function updateNoteCount() {
  const n = notes.length;
  noteCountEl.textContent = `${n} note${n !== 1 ? 's' : ''}`;
}

// ── VIEW SWITCHING ──────────────────────────────
function showView(name) {
  currentView = name;
  viewNew.classList.toggle('hidden',    name !== 'new');
  viewSearch.classList.toggle('hidden', name !== 'search');
  viewList.classList.toggle('hidden',   name !== 'list');

  btnNew.classList.toggle('active',    name === 'new');
  btnSearch.classList.toggle('active', name === 'search');
  btnList.classList.toggle('active',   name === 'list');

  sortBar.classList.toggle('hidden', name !== 'list');

  if (name === 'list') { renderAllNotes(); renderTagSidebar(); }
  if (name === 'search') { searchInput.focus(); renderSearch(); }
  if (name === 'new' && !editingId) resetForm();
}

btnNew.addEventListener('click',    () => { editingId = null; showView('new'); });
btnSearch.addEventListener('click', () => showView('search'));
btnList.addEventListener('click',   () => showView('list'));

// ── SORT BUTTONS ────────────────────────────────
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sortBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sortMode = btn.dataset.sort;
    renderAllNotes();
  });
});

// ── FORM ────────────────────────────────────────
function resetForm() {
  editingId = null;
  selectedColor = null;
  noteTitle.value   = '';
  noteBody.value    = '';
  noteComment.value = '';
  charCount.textContent = '0 chars · 0 words';
  btnSave.textContent = 'Save →';
  btnCancelEdit.style.display = 'none';
  noteBody.classList.remove('warning');
  charCount.classList.remove('warning');

  // Reset markdown preview
  markdownPreview.classList.add('hidden');
  noteBody.classList.remove('hidden');
  btnMarkdownToggle.classList.remove('active');
  btnMarkdownToggle.textContent = 'Preview 👁';
  markdownPreview.innerHTML = '';

  // Reset template buttons
  templateBtns.forEach(b => b.classList.remove('active'));
  templateBtns[0].classList.add('active');

  // Reset color buttons - random is default
  colorBtns.forEach(b => b.classList.remove('active'));
  btnRandomColor.classList.add('active');
}

noteBody.addEventListener('input', () => {
  charCount.textContent = countWordsChars(noteBody.value);
  // Character limit warning
  const len = noteBody.value.length;
  if (len > MAX_BODY * 0.9) {
    noteBody.classList.add('warning');
    charCount.classList.add('warning');
  } else {
    noteBody.classList.remove('warning');
    charCount.classList.remove('warning');
  }
  // Update markdown preview if visible
  if (!markdownPreview.classList.contains('hidden')) {
    markdownPreview.innerHTML = parseMarkdown(noteBody.value);
  }
});

// ── MARKDOWN TOGGLE ───────────────────────────────
btnMarkdownToggle.addEventListener('click', () => {
  const isPreview = markdownPreview.classList.contains('hidden');
  if (isPreview) {
    // Show preview
    markdownPreview.classList.remove('hidden');
    noteBody.classList.add('hidden');
    btnMarkdownToggle.classList.add('active');
    btnMarkdownToggle.textContent = 'Edit ✏️';
    markdownPreview.innerHTML = parseMarkdown(noteBody.value);
  } else {
    // Show editor
    markdownPreview.classList.add('hidden');
    noteBody.classList.remove('hidden');
    btnMarkdownToggle.classList.remove('active');
    btnMarkdownToggle.textContent = 'Preview 👁';
  }
});

btnCancelEdit.addEventListener('click', () => {
  resetForm();
  showView('list');
});

btnSave.addEventListener('click', saveNote);
noteBody.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveNote();
});

function saveNote() {
  const body = noteBody.value.trim();
  if (!body) { noteBody.focus(); shakeEl(noteBody); return; }

  const title   = noteTitle.value.trim();
  const comment = noteComment.value.trim();
  const tags    = extractTags(body);

  if (editingId) {
    const idx = notes.findIndex(n => n.id === editingId);
    if (idx > -1) {
      // Preserve existing color/favorite unless manually changed
      const existing = notes[idx];
      notes[idx] = {
        ...existing,
        title, body, comment, tags,
        color: selectedColor !== null ? selectedColor : existing.color,
        updatedAt: Date.now()
      };
    }
    showToast('✏️ Note updated!');
  } else {
    const newNote = {
      id: uid(), title, body, comment, tags,
      color: selectedColor !== null ? selectedColor : randColor(),
      pinned: false,
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.unshift(newNote);
    showToast('✅ Note saved!');
  }

  saveNotes();
  resetForm();
  showView('list');
}

function shakeEl(el) {
  el.style.animation = 'none';
  el.getBoundingClientRect();
  el.style.animation = 'shake .3s ease';
}

// ── RENDER CARDS ────────────────────────────────
function sortedNotes(list) {
  return [...list].sort((a, b) => {
    // Pinned notes always first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return  1;

    // Then apply selected sort mode
    switch (sortMode) {
      case 'oldest':
        return a.updatedAt - b.updatedAt;
      case 'az':
        const titleA = (a.title || a.body || '').toLowerCase();
        const titleB = (b.title || b.body || '').toLowerCase();
        return titleA.localeCompare(titleB);
      case 'color':
        return a.color - b.color;
      case 'newest':
      default:
        return b.updatedAt - a.updatedAt;
    }
  });
}

function buildCard(note, query = '', mode = 'normal') {
  const card = document.createElement('div');
  card.className = `note-card nc-${note.color}`;
  card.dataset.id = note.id;

  // Make pinned notes draggable for reordering
  if (note.pinned) {
    card.draggable = true;
    card.dataset.draggable = 'true';
  }

  const titleHtml   = note.title   ? `<div class="note-title">${highlight(note.title,   query, mode)}</div>` : '';
  const bodyHtml    = note.body    ? `<div class="note-body">${highlight(note.body,    query, mode)}</div>` : '';
  const commentHtml = note.comment ? `<div class="note-comment">💬 ${highlight(note.comment, query, mode)}</div>` : '';
  const pinBadge    = note.pinned  ? `<span class="note-pin-badge">📌</span>` : '';
  const favBadge    = note.favorite ? `<span class="note-fav-badge">⭐</span>` : '';
  const tagsHtml    = note.tags && note.tags.length
    ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const ts = note.updatedAt || note.createdAt;
  const timeHtml = `<span class="note-time" title="${fullDate(ts)}">${timeAgo(ts)}</span>`;

  card.innerHTML = `
    ${pinBadge}
    ${favBadge}
    ${titleHtml}
    ${bodyHtml}
    ${commentHtml}
    ${tagsHtml}
    <div class="note-footer">
      ${timeHtml}
      <div class="note-actions">
        <button class="note-action-btn" data-action="pin"  title="${note.pinned ? 'Unpin' : 'Pin'}">${note.pinned ? '📌' : '📍'}</button>
        <button class="note-action-btn" data-action="favorite" title="${note.favorite ? 'Unfavorite' : 'Favorite'}">${note.favorite ? '⭐' : '☆'}</button>
        <button class="note-action-btn" data-action="duplicate" title="Duplicate">📄</button>
        <button class="note-action-btn" data-action="copy" title="Copy body">📋</button>
        <button class="note-action-btn" data-action="edit" title="Edit">✏️</button>
        <button class="note-action-btn" data-action="del"  title="Delete">🗑</button>
      </div>
    </div>
  `;

  card.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      handleCardAction(btn.dataset.action, note.id);
      return;
    }
    // Clicking anywhere else on the card opens the view modal
    openViewModal(note.id);
  });

  // Drag and drop for pinned notes
  if (note.pinned) {
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', note.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.note-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (card.dataset.draggable === 'true' && card.dataset.id !== note.id) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== note.id) {
        reorderPinnedNotes(draggedId, note.id);
      }
    });
  }

  return card;
}

function renderAllNotes() {
  allNotes.innerHTML = '';
  let filtered = notes;
  if (activeTag) {
    filtered = notes.filter(n => (n.tags || []).includes(activeTag));
  }
  const sorted = sortedNotes(filtered);
  if (sorted.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    sorted.forEach(n => allNotes.appendChild(buildCard(n)));
  }
}

// ── TAG SIDEBAR ──────────────────────────────────
function renderTagSidebar() {
  tagList.innerHTML = '';

  // Count tags
  const tagCounts = {};
  notes.forEach(n => {
    (n.tags || []).forEach(t => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });

  // Sort tags by count
  const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  // "All" button
  const allBtn = document.createElement('div');
  allBtn.className = `tag-filter ${!activeTag ? 'active' : ''}`;
  allBtn.textContent = `All ${notes.length > 0 ? `(${notes.length})` : ''}`;
  allBtn.addEventListener('click', () => {
    activeTag = null;
    renderTagSidebar();
    renderAllNotes();
  });
  tagList.appendChild(allBtn);

  // Tag buttons
  sortedTags.forEach(([tag, count]) => {
    const btn = document.createElement('div');
    btn.className = `tag-filter ${activeTag === tag ? 'active' : ''}`;
    btn.innerHTML = `${escapeHtml(tag)} <span class="tag-count">(${count})</span>`;
    btn.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagSidebar();
      renderAllNotes();
    });
    tagList.appendChild(btn);
  });
}

// ── SEARCH ──────────────────────────────────────
modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    searchMode = btn.dataset.mode;
    renderSearch();
  });
});

searchInput.addEventListener('input', renderSearch);

function renderSearch() {
  const q = searchInput.value.trim();
  searchError.classList.add('hidden');
  searchResults.innerHTML = '';

  // Validate regex
  if (searchMode === 'regex' && q) {
    try { new RegExp(q); } catch {
      searchError.classList.remove('hidden');
      return;
    }
  }

  const filtered = sortedNotes(notes).filter(n => matchesSearch(n, q, searchMode));
  filtered.forEach(n => searchResults.appendChild(buildCard(n, q, searchMode)));
}

// ── CARD ACTIONS ────────────────────────────────
function handleCardAction(action, id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  if (action === 'pin') {
    note.pinned = !note.pinned;
    saveNotes();
    if (currentView === 'list')   renderAllNotes();
    if (currentView === 'search') renderSearch();
    showToast(note.pinned ? '📌 Pinned!' : '📍 Unpinned');
  }

  if (action === 'favorite') {
    note.favorite = !note.favorite;
    saveNotes();
    if (currentView === 'list')   renderAllNotes();
    if (currentView === 'search') renderSearch();
    showToast(note.favorite ? '⭐ Favorited!' : '☆ Unfavorited');
  }

  if (action === 'copy') {
    navigator.clipboard.writeText(note.body).then(() => showToast('📋 Copied!'));
  }

  if (action === 'duplicate') {
    const duplicate = {
      ...note,
      id: uid(),
      title: note.title ? `${note.title} (copy)` : '',
      pinned: false,
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.unshift(duplicate);
    saveNotes();
    if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
    if (currentView === 'search') renderSearch();
    showToast('📄 Note duplicated!');
  }

  if (action === 'edit') {
    editingId = id;
    noteTitle.value   = note.title   || '';
    noteBody.value    = note.body    || '';
    noteComment.value = note.comment || '';
    charCount.textContent = countWordsChars(note.body || '');
    btnSave.textContent = 'Update →';
    btnCancelEdit.style.display = '';

    // Set color picker to note's current color
    colorBtns.forEach(b => b.classList.remove('active'));
    btnRandomColor.classList.remove('active');
    const colorBtn = document.querySelector(`.color-btn[data-color="${note.color}"]`);
    if (colorBtn) colorBtn.classList.add('active');
    selectedColor = note.color;

    showView('new');
    noteBody.focus();
  }

  if (action === 'del') {
    // Store for undo and remove immediately
    pendingDelete = { ...note };
    notes = notes.filter(n => n.id !== id);
    saveNotes();

    if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
    if (currentView === 'search') renderSearch();

    // Show undo toast
    showToastWithUndo('🗑 Note deleted', () => {
      // Undo callback
      notes.unshift(pendingDelete);
      pendingDelete = null;
      saveNotes();
      if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
      if (currentView === 'search') renderSearch();
      showToast('↩️ Note restored!');
    });
  }
}

// ── REORDER PINNED NOTES ──────────────────────────
function reorderPinnedNotes(draggedId, targetId) {
  const draggedIdx = notes.findIndex(n => n.id === draggedId);
  const targetIdx = notes.findIndex(n => n.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) return;

  // Remove dragged note and insert at target position
  const [dragged] = notes.splice(draggedIdx, 1);
  notes.splice(targetIdx, 0, dragged);

  saveNotes();
  renderAllNotes();
}

// ── VIEW NOTE MODAL ───────────────────────────────
function openViewModal(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;

  currentViewNoteId = noteId;
  viewModalTitle.textContent = note.title || '(Untitled)';
  viewModalMeta.innerHTML = '';

  // Add badges
  if (note.pinned) viewModalMeta.innerHTML += '<span class="view-modal-meta-tag">📌 Pinned</span>';
  if (note.favorite) viewModalMeta.innerHTML += '<span class="view-modal-meta-tag">⭐ Favorite</span>';

  // Add date
  const dateStr = fullDate(note.updatedAt || note.createdAt);
  viewModalMeta.innerHTML += `<span class="view-modal-meta-tag">📅 ${dateStr}</span>`;

  // Add tags
  if (note.tags && note.tags.length) {
    note.tags.forEach(t => {
      viewModalMeta.innerHTML += `<span class="view-modal-meta-tag">${escapeHtml(t)}</span>`;
    });
  }

  // Add comment if exists
  if (note.comment) {
    viewModalMeta.innerHTML += `<span class="view-modal-meta-tag">💬 ${escapeHtml(note.comment)}</span>`;
  }

  // Render body with markdown
  if (note.body) {
    viewModalBody.innerHTML = parseMarkdown(note.body);
    viewModalBody.classList.remove('empty');
  } else {
    viewModalBody.innerHTML = '(No content)';
    viewModalBody.classList.add('empty');
  }

  viewModalOverlay.classList.remove('hidden');
}

function closeViewModal() {
  viewModalOverlay.classList.add('hidden');
  currentViewNoteId = null;
}

btnCloseViewModal.addEventListener('click', closeViewModal);
btnViewModalClose.addEventListener('click', closeViewModal);
viewModalOverlay.addEventListener('click', e => {
  if (e.target === viewModalOverlay) closeViewModal();
});

btnViewModalEdit.addEventListener('click', () => {
  const noteId = currentViewNoteId;
  closeViewModal();
  if (noteId) {
    handleCardAction('edit', noteId);
  }
});

// ── DELETE DIALOG (kept for reference, no longer used) ──
btnCancelDelete.addEventListener('click', () => {
  deleteId = null;
  overlay.classList.add('hidden');
});

btnConfirmDelete.addEventListener('click', () => {
  notes = notes.filter(n => n.id !== deleteId);
  saveNotes();
  overlay.classList.add('hidden');
  deleteId = null;
  if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
  if (currentView === 'search') renderSearch();
  showToast('🗑 Note deleted');
});

// ── TOAST ────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toastUndo.classList.add('hidden');
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 220);
  }, 2000);
}

function showToastWithUndo(msg, undoCallback) {
  clearTimeout(undoTimer);
  toastMsg.textContent = msg;
  toastUndo.classList.remove('hidden');
  toast.classList.remove('hidden');
  void toast.offsetWidth;
  toast.classList.add('show');

  // Clear any previous timer
  clearTimeout(toastTimer);

  // Set up undo button
  toastUndo.onclick = () => {
    clearTimeout(undoTimer);
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 220);
    undoCallback();
  };

  // Auto-dismiss after 5 seconds
  undoTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 220);
    pendingDelete = null;
  }, 5000);
}

// ── SHAKE KEYFRAME ───────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%,100%{ transform: translateX(0); }
    20%    { transform: translateX(-5px); }
    40%    { transform: translateX(5px); }
    60%    { transform: translateX(-4px); }
    80%    { transform: translateX(4px); }
  }
`;
document.head.appendChild(style);

// ── INIT ─────────────────────────────────────────
loadNotes().then(() => {
  updateNoteCount();
  showView('new');
  noteBody.focus();
});
