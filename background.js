/* ─────────────────────────────────────────────
   QuickNote — background.js (Service Worker)
   ───────────────────────────────────────────── */

// Listen for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('reminder_')) {
    const noteId = alarm.name.replace('reminder_', '');

    // Get the note from storage
    const data = await chrome.storage.local.get(['qn_notes']);
    const notes = data.qn_notes || [];
    const note = notes.find(n => n.id === noteId);

    if (note && note.reminder) {
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'QuickNote Reminder',
        message: note.title ? `${note.title}\n${note.body.substring(0, 100)}${note.body.length > 100 ? '...' : ''}` : note.body.substring(0, 150),
        buttons: [{ title: 'View Note' }],
        priority: 1
      });

      // Clear the reminder from the note
      note.reminder = null;
      await chrome.storage.local.set({ qn_notes: notes });
    }
  }
});

// Handle notification button click
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  // Open the extension popup (user can't directly programmatically open popup,
  // but we could open options page or just rely on user clicking the extension icon)
  chrome.notifications.clear(notificationId);
});

// Handle notification click
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});
