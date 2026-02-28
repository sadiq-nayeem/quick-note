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

// Settings
let settings = {
  defaultSort: 'newest',
  showActionsAlways: false,
  remindersEnabled: false,
  smartRulesEnabled: false,
  rulesTrigger: 'manual',     // 'manual' | 'typing' | 'autosave'
  rulesPriority: 'first',     // 'first' | 'all'
  reminderAction: 'dismiss',  // 'dismiss' | 'snooze' | 'both'
  smartRules: [],             // Array of rule objects
  contextMenuEnabled: false,  // Enable context menu
  globalShortcutEnabled: true, // Enable global shortcut
  noteLinkingEnabled: true    // Enable cross-note references
};

// Rule being edited
let editingRuleIndex = -1;

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

// ── NOTE LINKING ─────────────────────────────────
function extractReferences(text) {
  if (!text || !settings.noteLinkingEnabled) return [];
  const matches = text.matchAll(/\[\[([^\]]+)\]\]/g);
  const refs = [];
  const seenTitles = new Set();

  for (const match of matches) {
    const targetTitle = match[1].toLowerCase().trim();
    if (seenTitles.has(targetTitle)) continue;
    seenTitles.add(targetTitle);

    // Find note by title (partial match)
    const note = notes.find(n =>
      n.title && n.title.toLowerCase().includes(targetTitle) && n.id !== editingId
    );
    if (note) refs.push({ id: note.id, title: note.title });
  }
  return refs;
}

function updateNoteLinks(noteId, references) {
  // Remove this note from all linkedNotes arrays first
  notes.forEach(n => {
    if (n.linkedNotes) {
      n.linkedNotes = n.linkedNotes.filter(id => id !== noteId);
    }
  });

  // Add this note to referenced notes' linkedNotes
  references.forEach(ref => {
    const targetNote = notes.find(n => n.id === ref.id);
    if (targetNote) {
      if (!targetNote.linkedNotes) targetNote.linkedNotes = [];
      if (!targetNote.linkedNotes.includes(noteId)) {
        targetNote.linkedNotes.push(noteId);
      }
    }
  });
}

// ── SMART RULES ───────────────────────────────────
function applyTemplate(template, captures) {
  if (!template) return '';
  let result = template;
  captures.forEach((match, i) => {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), match || '');
  });
  return result;
}

function findMatchingRules(text) {
  if (!text || !settings.smartRulesEnabled) return [];
  const matches = [];
  for (const rule of settings.smartRules) {
    if (!rule.enabled) continue;
    try {
      const regex = new RegExp(rule.pattern, 'gi');
      const match = regex.exec(text);
      if (match) {
        matches.push({
          rule,
          captures: match.slice(1), // Exclude full match, keep groups
          fullMatch: match[0]
        });
        if (settings.rulesPriority === 'first') break;
      }
    } catch {
      // Invalid regex, skip
    }
  }
  return matches;
}

function applyRule(matchData) {
  const { rule, captures } = matchData;
  if (rule.titleTemplate) {
    noteTitle.value = applyTemplate(rule.titleTemplate, captures);
  }
  if (rule.commentTemplate) {
    noteComment.value = applyTemplate(rule.commentTemplate, captures);
  }
  if (rule.color !== undefined && rule.color !== '') {
    selectedColor = parseInt(rule.color);
    colorBtns.forEach(b => b.classList.remove('active'));
    btnRandomColor.classList.remove('active');
    const colorBtn = document.querySelector(`.color-btn[data-color="${rule.color}"]`);
    if (colorBtn) colorBtn.classList.add('active');
  }
  // Handle recurring reminder
  if (rule.interval && rule.interval > 0) {
    reminderToggle.checked = true;
    reminderDate.disabled = false;
    // Set reminder to interval from now
    const reminderTime = Date.now() + (parseInt(rule.interval) * 60 * 1000);
    reminderDate.value = new Date(reminderTime - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
}

function showRuleMatches(matches) {
  if (matches.length === 0) {
    ruleMatches.classList.add('hidden');
    return;
  }
  ruleMatchList.innerHTML = '';
  matches.forEach(m => {
    const chip = document.createElement('div');
    chip.className = 'rule-match-chip';
    chip.innerHTML = `${m.rule.name} <span class="rule-match-chip-small">(${m.fullMatch})</span>`;
    chip.addEventListener('click', () => {
      applyRule(m);
      showToast(`📜 Applied "${m.rule.name}"`);
    });
    ruleMatchList.appendChild(chip);
  });
  ruleMatches.classList.remove('hidden');
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

// ── DOM REFS ────────────────────────────────────
const themeBtn       = document.getElementById('themeBtn');
const settingsBtn    = document.getElementById('settingsBtn');
const importBtn      = document.getElementById('importBtn');
const exportBtn      = document.getElementById('exportBtn');
const importInput    = document.getElementById('importInput');
const noteCountEl    = document.getElementById('noteCount');

const btnMarkdownHelp = document.getElementById('btnMarkdownHelp');
const markdownHelpTooltip = document.getElementById('markdownHelpTooltip');

const settingsOverlay = document.getElementById('settingsOverlay');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const settingSortOrder = document.getElementById('settingSortOrder');
const settingShowActions = document.getElementById('settingShowActions');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnClearAll = document.getElementById('btnClearAll');
const settingReminders = document.getElementById('settingReminders');
const settingSmartRules = document.getElementById('settingSmartRules');
const settingRulesTrigger = document.getElementById('settingRulesTrigger');
const settingRulesPriority = document.getElementById('settingRulesPriority');
const settingReminderAction = document.getElementById('settingReminderAction');
const settingContextMenu = document.getElementById('settingContextMenu');
const settingGlobalShortcut = document.getElementById('settingGlobalShortcut');
const settingNoteLinking = document.getElementById('settingNoteLinking');
const themeOptions = document.querySelectorAll('.theme-option');

// Smart Rules UI
const btnEditRules = document.getElementById('btnEditRules');
const rulesOverlay = document.getElementById('rulesOverlay');
const btnCloseRules = document.getElementById('btnCloseRules');
const rulesList = document.getElementById('rulesList');
const btnAddRule = document.getElementById('btnAddRule');
const btnSaveRules = document.getElementById('btnSaveRules');

// Rule Edit Modal
const ruleEditOverlay = document.getElementById('ruleEditOverlay');
const btnCloseRuleEdit = document.getElementById('btnCloseRuleEdit');
const ruleEditTitle = document.getElementById('ruleEditTitle');
const ruleName = document.getElementById('ruleName');
const rulePattern = document.getElementById('rulePattern');
const ruleTitle = document.getElementById('ruleTitle');
const ruleComment = document.getElementById('ruleComment');
const ruleInterval = document.getElementById('ruleInterval');
const ruleColors = document.getElementById('ruleColors');
const ruleEnabled = document.getElementById('ruleEnabled');
const btnSaveRule = document.getElementById('btnSaveRule');
const btnDeleteRule = document.getElementById('btnDeleteRule');

// Rule Matches
const ruleMatches = document.getElementById('ruleMatches');
const ruleMatchList = document.getElementById('ruleMatchList');

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

const reminderToggle = document.getElementById('reminderToggle');
const reminderDate = document.getElementById('reminderDate');

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

// ── STORAGE ────────────────────────────────────
function loadNotes() {
  return new Promise(resolve => {
    chrome.storage.local.get(['qn_notes', 'qn_theme', 'qn_settings', '_pendingNote'], data => {
      notes = data.qn_notes || [];

      // Load theme
      if (data.qn_theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeBtn.textContent = '☀';
      }

      // Load settings
      if (data.qn_settings) {
        settings = { ...settings, ...data.qn_settings };
        sortMode = settings.defaultSort;
        applySettings();
      }

      // Check for pending note from context menu
      if (data._pendingNote) {
        noteBody.value = data._pendingNote;
        charCount.textContent = countWordsChars(data._pendingNote);
        // Clear pending note
        chrome.storage.local.remove('_pendingNote');
        showToast('📄 Text captured from selection!');
      }

      resolve();
    });
  });
}

function saveNotes() {
  chrome.storage.local.set({ qn_notes: notes });
  updateNoteCount();
}

function saveSettings() {
  chrome.storage.local.set({ qn_settings: settings });
}

function applySettings() {
  // Apply show actions setting
  const actionBtns = document.querySelectorAll('.note-actions');
  actionBtns.forEach(btn => {
    if (settings.showActionsAlways) {
      btn.classList.add('show-always');
    } else {
      btn.classList.remove('show-always');
    }
  });
}

// ── SETTINGS MODAL ───────────────────────────────
function openSettings() {
  settingSortOrder.value = settings.defaultSort;
  settingShowActions.checked = settings.showActionsAlways;
  settingReminders.checked = settings.remindersEnabled;
  settingSmartRules.checked = settings.smartRulesEnabled;
  settingRulesTrigger.value = settings.rulesTrigger;
  settingRulesPriority.value = settings.rulesPriority;
  settingReminderAction.value = settings.reminderAction;
  settingContextMenu.checked = settings.contextMenuEnabled;
  settingGlobalShortcut.checked = settings.globalShortcutEnabled;
  settingNoteLinking.checked = settings.noteLinkingEnabled;

  // Set active theme option
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  themeOptions.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });

  settingsOverlay.classList.remove('hidden');
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', e => {
  if (e.target === settingsOverlay) closeSettings();
});

btnSaveSettings.addEventListener('click', () => {
  settings.defaultSort = settingSortOrder.value;
  settings.showActionsAlways = settingShowActions.checked;
  settings.remindersEnabled = settingReminders.checked;
  settings.smartRulesEnabled = settingSmartRules.checked;
  settings.rulesTrigger = settingRulesTrigger.value;
  settings.rulesPriority = settingRulesPriority.value;
  settings.reminderAction = settingReminderAction.value;
  settings.contextMenuEnabled = settingContextMenu.checked;
  settings.globalShortcutEnabled = settingGlobalShortcut.checked;
  settings.noteLinkingEnabled = settingNoteLinking.checked;
  saveSettings();
  sortMode = settings.defaultSort;
  applySettings();
  if (currentView === 'list') renderAllNotes();
  closeSettings();
  showToast('⚙ Settings saved!');
});

// Theme buttons in settings
themeOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    themeOptions.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      themeBtn.textContent = '☀';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeBtn.textContent = '🌙';
    }
    chrome.storage.local.set({ qn_theme: theme });
  });
});

// Clear all notes
btnClearAll.addEventListener('click', () => {
  if (confirm('Are you sure you want to delete ALL notes? This cannot be undone!')) {
    notes = [];
    saveNotes();
    if (currentView === 'list') { renderAllNotes(); renderTagSidebar(); }
    closeSettings();
    showToast('🗑 All notes cleared');
  }
});

// ── MARKDOWN HELP ───────────────────────────────
btnMarkdownHelp.addEventListener('click', e => {
  e.stopPropagation();
  markdownHelpTooltip.classList.toggle('hidden');
});

// Close help when clicking elsewhere
document.addEventListener('click', () => {
  markdownHelpTooltip.classList.add('hidden');
});

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

// ── SMART RULES UI ───────────────────────────────
btnEditRules.addEventListener('click', () => {
  renderRulesList();
  rulesOverlay.classList.remove('hidden');
});

btnCloseRules.addEventListener('click', () => {
  rulesOverlay.classList.add('hidden');
});

rulesOverlay.addEventListener('click', e => {
  if (e.target === rulesOverlay) rulesOverlay.classList.add('hidden');
});

function renderRulesList() {
  rulesList.innerHTML = '';
  if (settings.smartRules.length === 0) {
    rulesList.innerHTML = '<div class="empty-state"><p>No rules yet. Click "Add New Rule" to create one!</p></div>';
    return;
  }

  settings.smartRules.forEach((rule, index) => {
    const item = document.createElement('div');
    item.className = `rule-item ${rule.enabled ? '' : 'disabled'}`;
    item.innerHTML = `
      <div class="rule-item-header">
        <span class="rule-item-name">${escapeHtml(rule.name)}</span>
        <span class="rule-item-enabled">${rule.enabled ? 'ON' : 'OFF'}</span>
      </div>
      <div class="rule-item-pattern">Pattern: <code>${escapeHtml(rule.pattern)}</code></div>
      <div class="rule-item-templates">
        ${rule.titleTemplate ? `<span>Title: ${escapeHtml(rule.titleTemplate)}</span>` : ''}
        ${rule.commentTemplate ? `<span>Comment: ${escapeHtml(rule.commentTemplate)}</span>` : ''}
        ${rule.interval ? `<span>⏰ Every ${rule.interval}min</span>` : ''}
        ${rule.color !== '' ? `<span>🎨 Color ${rule.color}</span>` : ''}
      </div>
    `;
    item.addEventListener('click', () => openRuleEdit(index));
    rulesList.appendChild(item);
  });
}

btnAddRule.addEventListener('click', () => {
  openRuleEdit(-1); // -1 = new rule
});

function openRuleEdit(index) {
  editingRuleIndex = index;
  if (index >= 0) {
    // Edit existing rule
    const rule = settings.smartRules[index];
    ruleEditTitle.textContent = 'Edit Rule';
    ruleName.value = rule.name;
    rulePattern.value = rule.pattern;
    ruleTitle.value = rule.titleTemplate || '';
    ruleComment.value = rule.commentTemplate || '';
    ruleInterval.value = rule.interval || '';
    ruleEnabled.checked = rule.enabled;
    btnDeleteRule.style.display = '';
  } else {
    // New rule
    ruleEditTitle.textContent = 'New Rule';
    ruleName.value = '';
    rulePattern.value = '';
    ruleTitle.value = '';
    ruleComment.value = '';
    ruleInterval.value = '';
    ruleEnabled.checked = true;
    btnDeleteRule.style.display = 'none';
  }

  // Set color button state
  const currentColor = index >= 0 ? settings.smartRules[index].color : '';
  ruleColors.querySelectorAll('.rule-color-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.color === String(currentColor)) {
      btn.classList.add('active');
    }
  });

  ruleEditOverlay.classList.remove('hidden');
}

btnCloseRuleEdit.addEventListener('click', () => {
  ruleEditOverlay.classList.add('hidden');
});

ruleEditOverlay.addEventListener('click', e => {
  if (e.target === ruleEditOverlay) ruleEditOverlay.classList.add('hidden');
});

// Color buttons in rule edit
ruleColors.querySelectorAll('.rule-color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    ruleColors.querySelectorAll('.rule-color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

btnSaveRule.addEventListener('click', () => {
  const activeColorBtn = ruleColors.querySelector('.rule-color-btn.active');
  const color = activeColorBtn ? activeColorBtn.dataset.color : '';

  const rule = {
    name: ruleName.value.trim() || 'Untitled Rule',
    pattern: rulePattern.value.trim(),
    titleTemplate: ruleTitle.value.trim(),
    commentTemplate: ruleComment.value.trim(),
    interval: ruleInterval.value ? parseInt(ruleInterval.value) : null,
    color: color,
    enabled: ruleEnabled.checked
  };

  // Validate regex
  if (!rule.pattern) {
    showToast('⚠️ Please enter a pattern!');
    return;
  }
  try {
    new RegExp(rule.pattern);
  } catch {
    showToast('⚠️ Invalid regex pattern!');
    return;
  }

  if (editingRuleIndex >= 0) {
    settings.smartRules[editingRuleIndex] = rule;
  } else {
    settings.smartRules.push(rule);
  }

  renderRulesList();
  ruleEditOverlay.classList.add('hidden');
  showToast('📜 Rule saved!');
});

btnDeleteRule.addEventListener('click', () => {
  if (confirm('Delete this rule?')) {
    settings.smartRules.splice(editingRuleIndex, 1);
    renderRulesList();
    ruleEditOverlay.classList.add('hidden');
    showToast('🗑 Rule deleted');
  }
});

btnSaveRules.addEventListener('click', () => {
  settings.smartRules = [...settings.smartRules];
  saveSettings();
  rulesOverlay.classList.add('hidden');
  showToast('📜 Rules saved!');
});

// ── REMINDER TOGGLE ───────────────────────────────
reminderToggle.addEventListener('change', () => {
  reminderDate.disabled = !reminderToggle.checked;
  if (!reminderToggle.checked) {
    reminderDate.value = '';
  }
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
  if (name === 'new' && !editingId) {
    // Don't reset if we have a pending note from context menu
    chrome.storage.local.get(['_pendingNote'], data => {
      if (!data._pendingNote) resetForm();
    });
  }
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

  // Reset reminder
  reminderToggle.checked = false;
  reminderDate.value = '';
  reminderDate.disabled = true;

  // Hide rule matches
  ruleMatches.classList.add('hidden');
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
  // Check for smart rule matches
  if (settings.smartRulesEnabled && settings.rulesTrigger === 'typing') {
    const matches = findMatchingRules(noteBody.value);
    showRuleMatches(matches);
  } else {
    ruleMatches.classList.add('hidden');
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

  // Auto-apply rules if enabled and in autosave mode
  if (settings.smartRulesEnabled && settings.rulesTrigger === 'autosave' && !editingId) {
    const matches = findMatchingRules(body);
    if (matches.length > 0) {
      // Apply first match or all matches based on priority
      if (settings.rulesPriority === 'first') {
        applyRule(matches[0]);
      } else {
        matches.forEach(m => applyRule(m));
      }
    }
  }

  const title   = noteTitle.value.trim();
  const comment = noteComment.value.trim();
  const tags    = extractTags(body);
  const references = extractReferences(body);

  // Handle reminder
  let reminder = null;
  let recurringInterval = null; // in minutes for recurring reminders

  if (settings.remindersEnabled && reminderToggle.checked && reminderDate.value) {
    reminder = new Date(reminderDate.value).getTime();
    // Only set if it's in the future
    if (reminder <= Date.now()) {
      reminder = null;
      showToast('⚠️ Reminder must be in the future!');
    }
  }

  if (editingId) {
    const idx = notes.findIndex(n => n.id === editingId);
    if (idx > -1) {
      // Clear old alarm if exists
      if (notes[idx].reminder) {
        chrome.alarms.clear(`reminder_${editingId}`);
      }

      // Preserve existing color/favorite unless manually changed
      const existing = notes[idx];
      notes[idx] = {
        ...existing,
        title, body, comment, tags,
        color: selectedColor !== null ? selectedColor : existing.color,
        reminder,
        // Keep existing recurring interval unless manually changed
        recurringInterval: existing.recurringInterval,
        references,
        updatedAt: Date.now()
      };

      // Update bidirectional links
      updateNoteLinks(editingId, references);

      // Set new alarm
      if (reminder) {
        if (notes[idx].recurringInterval) {
          chrome.alarms.create(`reminder_${editingId}`, {
            when: reminder,
            periodInMinutes: notes[idx].recurringInterval
          });
        } else {
          chrome.alarms.create(`reminder_${editingId}`, { when: reminder });
        }
      }
    }
    showToast('✏️ Note updated!');
  } else {
    const newNote = {
      id: uid(), title, body, comment, tags,
      color: selectedColor !== null ? selectedColor : randColor(),
      pinned: false,
      favorite: false,
      reminder,
      recurringInterval: null, // Will be set if applicable
      references,
      linkedNotes: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Check if this note has a recurring reminder from a rule
    if (settings.smartRulesEnabled && settings.rulesTrigger === 'autosave') {
      const matches = findMatchingRules(body);
      if (matches.length > 0) {
        const match = settings.rulesPriority === 'first' ? matches[0] : matches[0];
        if (match.rule.interval) {
          newNote.recurringInterval = parseInt(match.rule.interval);
        }
      }
    }

    notes.unshift(newNote);

    // Set alarm for new note (use periodInMinutes for recurring)
    if (reminder) {
      if (newNote.recurringInterval) {
        chrome.alarms.create(`reminder_${newNote.id}`, {
          when: reminder,
          periodInMinutes: newNote.recurringInterval
        });
      } else {
        chrome.alarms.create(`reminder_${newNote.id}`, { when: reminder });
      }
    }

    // Update bidirectional links for new note
    updateNoteLinks(newNote.id, references);

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
  const remBadge    = note.reminder ? `<span class="note-rem-badge">🔔</span>` : '';
  const tagsHtml    = note.tags && note.tags.length
    ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  const ts = note.updatedAt || note.createdAt;
  const timeHtml = `<span class="note-time" title="${fullDate(ts)}">${timeAgo(ts)}</span>`;

  card.innerHTML = `
    ${pinBadge}
    ${favBadge}
    ${remBadge}
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

    // Set reminder
    if (note.reminder && settings.remindersEnabled) {
      reminderToggle.checked = true;
      reminderDate.disabled = false;
      const date = new Date(note.reminder);
      // Format for datetime-local input: YYYY-MM-DDTHH:mm
      reminderDate.value = date.toISOString().slice(0, 16);
    } else {
      reminderToggle.checked = false;
      reminderDate.disabled = true;
      reminderDate.value = '';
    }

    showView('new');
    noteBody.focus();
  }

  if (action === 'del') {
    // Clear alarm if exists
    if (note.reminder) {
      chrome.alarms.clear(`reminder_${id}`);
    }

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

  // Add references/backlinks if enabled
  if (settings.noteLinkingEnabled) {
    const refs = note.references || [];
    const backlinks = note.linkedNotes || [];
    let refsHtml = '';

    if (refs.length > 0) {
      refsHtml += '<span style="font-size:10px;font-weight:700;color:var(--text-sub);margin-right:8px;">📎 Referenced:</span>';
      refs.forEach(ref => {
        refsHtml += `<span class="view-modal-meta-tag view-modal-ref" data-note-id="${ref.id}" style="cursor:pointer;background:var(--accent);color:#fff;">${escapeHtml(ref.title)}</span>`;
      });
    }
    if (backlinks.length > 0) {
      if (refsHtml) refsHtml += '<span style="margin:0 4px;">|</span>';
      refsHtml += '<span style="font-size:10px;font-weight:700;color:var(--text-sub);margin-right:8px;">🔗 Backlinks:</span>';
      backlinks.forEach(backId => {
        const backNote = notes.find(n => n.id === backId);
        if (backNote) {
          refsHtml += `<span class="view-modal-meta-tag view-modal-ref" data-note-id="${backId}" style="cursor:pointer;">${escapeHtml(backNote.title || '(Untitled)')}</span>`;
        }
      });
    }
    if (refsHtml) {
      viewModalMeta.innerHTML += refsHtml;
    }
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

  // Add click handlers for reference chips
  const refChips = viewModalMeta.querySelectorAll('.view-modal-ref');
  refChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const targetNoteId = chip.dataset.noteId;
      closeViewModal();
      openViewModal(targetNoteId);
    });
  });
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
