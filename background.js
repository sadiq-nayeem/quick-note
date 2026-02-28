/* ─────────────────────────────────────────────
   QuickNote — background.js (Service Worker)
   ───────────────────────────────────────────── */

// ── INSTALL / UPDATE ────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Clear any old context menu and recreate based on settings
  chrome.contextMenus.removeAll();

  const data = await chrome.storage.local.get(['qn_settings']);
  const settings = data.qn_settings || {};

  if (settings.contextMenuEnabled) {
    chrome.contextMenus.create({
      id: 'saveToQuickNote',
      title: 'Save to QuickNote',
      contexts: ['selection']
    });
  }

  // Listen for settings changes to update context menu
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && changes.qn_settings) {
      const newSettings = changes.qn_settings.newValue || {};
      const oldSettings = changes.qn_settings.oldValue || {};

      if (newSettings.contextMenuEnabled !== oldSettings.contextMenuEnabled) {
        chrome.contextMenus.removeAll();
        if (newSettings.contextMenuEnabled) {
          chrome.contextMenus.create({
            id: 'saveToQuickNote',
            title: 'Save to QuickNote',
            contexts: ['selection']
          });
        }
      }
    }
  });
});

// ── CONTEXT MENU ────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const data = await chrome.storage.local.get(['qn_settings']);
  if (data.qn_settings?.contextMenuEnabled) {
    // Store selected text for popup to retrieve
    chrome.storage.local.set({ '_pendingNote': info.selectionText });
    // Open popup
    chrome.action.openPopup();
  }
});

// ── QUICK CAPTURE FROM CURRENT TAB ───────────────
chrome.contextMenus.create({
  id: 'quickCapture',
  title: 'Quick Capture: Page Title & URL',
  contexts: ['page']
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'quickCapture') {
    const data = await chrome.storage.local.get(['qn_settings', 'qn_notes']);
    if (data.qn_settings?.contextMenuEnabled) {
      const notes = data.qn_notes || [];
      const newNote = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: tab.title,
        body: tab.url,
        comment: 'Captured from: ' + new Date().toLocaleString(),
        color: Math.floor(Math.random() * 7),
        pinned: false,
        favorite: false,
        reminder: null,
        recurringInterval: null,
        references: [],
        linkedNotes: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      notes.unshift(newNote);
      await chrome.storage.local.set({ qn_notes: notes });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🗒 QuickNote',
        message: 'Page captured as note!'
      });
    }
  }
});

// ── GLOBAL KEYBOARD SHORTCUT ───────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-quicknote') {
    const data = await chrome.storage.local.get(['qn_settings']);
    if (data.qn_settings?.globalShortcutEnabled !== false) {
      chrome.action.openPopup();
    }
  }
});

// ── ALARMS ──────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('reminder_')) {
    const noteId = alarm.name.replace('reminder_', '');

    // Get the note and settings from storage
    const data = await chrome.storage.local.get(['qn_notes', 'qn_settings']);
    const notes = data.qn_notes || [];
    const settings = data.qn_settings || {};
    const note = notes.find(n => n.id === noteId);

    if (note && note.reminder) {
      // Get reminder action preference
      const reminderAction = settings.reminderAction || 'dismiss';

      // Create notification with appropriate buttons
      const buttons = [];
      if (reminderAction === 'dismiss') {
        buttons.push({ title: '✕ Dismiss' });
      } else if (reminderAction === 'snooze') {
        buttons.push({ title: '⏰ Snooze 1h' });
      } else { // both
        buttons.push({ title: '✕ Dismiss' });
        buttons.push({ title: '⏰ Snooze 1h' });
      }

      // Show notification
      const notificationId = `reminder_${noteId}_${Date.now()}`;
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '🔔 QuickNote Reminder',
        message: note.title
          ? `${note.title}\n${note.body.substring(0, 100)}${note.body.length > 100 ? '...' : ''}`
          : note.body.substring(0, 150),
        buttons,
        priority: 1,
        requireInteraction: reminderAction === 'both'
      });

      // Store notification ID with note for handling button clicks
      await chrome.storage.local.set({ [`lastNotif_${noteId}`]: notificationId });
    }
  }
});

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const notificationData = await chrome.storage.local.get();
  let noteId = null;

  // Find which note this notification is for
  for (const key of Object.keys(notificationData)) {
    if (key.startsWith('lastNotif_') && notificationData[key] === notificationId) {
      noteId = key.replace('lastNotif_', '');
      break;
    }
  }

  if (!noteId) return;

  const data = await chrome.storage.local.get(['qn_notes', 'qn_settings']);
  const notes = data.qn_notes || [];
  const settings = data.qn_settings || {};
  const note = notes.find(n => n.id === noteId);

  if (!note) {
    chrome.notifications.clear(notificationId);
    return;
  }

  const reminderAction = settings.reminderAction || 'dismiss';

  // Handle based on which button was clicked
  if (reminderAction === 'dismiss') {
    // Dismiss button clicked - clear the alarm and remove reminder
    chrome.alarms.clear(`reminder_${noteId}`);
    note.reminder = null;
    note.recurringInterval = null;
  } else if (reminderAction === 'snooze') {
    // Snooze button clicked - reschedule for 1 hour from now
    const snoozeTime = Date.now() + (60 * 60 * 1000); // 1 hour
    if (note.recurringInterval) {
      chrome.alarms.create(`reminder_${noteId}`, {
        when: snoozeTime,
        periodInMinutes: note.recurringInterval
      });
    } else {
      chrome.alarms.create(`reminder_${noteId}`, { when: snoozeTime });
    }
    note.reminder = snoozeTime;
  } else { // both
    if (buttonIndex === 0) {
      // Dismiss clicked
      chrome.alarms.clear(`reminder_${noteId}`);
      note.reminder = null;
      note.recurringInterval = null;
    } else {
      // Snooze clicked
      const snoozeTime = Date.now() + (60 * 60 * 1000);
      if (note.recurringInterval) {
        chrome.alarms.create(`reminder_${noteId}`, {
          when: snoozeTime,
          periodInMinutes: note.recurringInterval
        });
      } else {
        chrome.alarms.create(`reminder_${noteId}`, { when: snoozeTime });
      }
      note.reminder = snoozeTime;
    }
  }

  // Save updated note
  await chrome.storage.local.set({ qn_notes: notes });
  chrome.notifications.clear(notificationId);
});

// Handle notification click (default action)
chrome.notifications.onClicked.addListener(async (notificationId) => {
  chrome.notifications.clear(notificationId);
});

// Handle notification closed
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  // If user closed the notification (not programmatically), you could
  // optionally snooze or dismiss based on settings
  if (byUser) {
    // User manually closed it - optionally snooze for 1 hour
    // This is a design choice - currently we do nothing
  }
});
