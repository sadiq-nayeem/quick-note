/* ─────────────────────────────────────────────
   QuickNote — content.js (Floating Site-Pin Button)
   ───────────────────────────────────────────── */

(function () {
    const HOST = location.hostname;
    if (!HOST) return;

    let btnEl = null;

    function getSitePinnedCount() {
        return new Promise(resolve => {
            chrome.storage.local.get(['qn_notes', 'qn_settings'], data => {
                const settings = data.qn_settings || {};
                if (!settings.tabPinEnabled) { resolve(0); return; }
                const notes = data.qn_notes || [];
                const count = notes.filter(n => n.pinnedUrl === HOST).length;
                resolve(count);
            });
        });
    }

    function createButton(count) {
        if (btnEl) { btnEl.remove(); btnEl = null; }
        if (count === 0) return;

        btnEl = document.createElement('div');
        btnEl.id = 'quicknote-site-pin-btn';
        btnEl.setAttribute('style', `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #FF7BAC, #D95C8C);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(200,80,140,.45);
      font-family: 'Segoe UI', sans-serif;
      font-size: 18px;
      font-weight: 800;
      user-select: none;
      transition: transform .15s, box-shadow .15s;
      border: none;
      outline: none;
    `);
        btnEl.textContent = '🗒';
        btnEl.title = `${count} QuickNote${count !== 1 ? 's' : ''} pinned to this site`;

        // Badge
        const badge = document.createElement('span');
        badge.setAttribute('style', `
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      background: #FF6B6B;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      box-shadow: 0 2px 6px rgba(0,0,0,.25);
    `);
        badge.textContent = count;
        btnEl.appendChild(badge);

        // Hover effects
        btnEl.addEventListener('mouseenter', () => {
            btnEl.style.transform = 'scale(1.12)';
            btnEl.style.boxShadow = '0 6px 24px rgba(200,80,140,.6)';
        });
        btnEl.addEventListener('mouseleave', () => {
            btnEl.style.transform = 'scale(1)';
            btnEl.style.boxShadow = '0 4px 16px rgba(200,80,140,.45)';
        });

        // Click → open popup to All Notes
        btnEl.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'openQuickNoteList' });
        });

        document.body.appendChild(btnEl);
    }

    // Initial check
    getSitePinnedCount().then(createButton);

    // Live update when notes change
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.qn_notes || changes.qn_settings)) {
            getSitePinnedCount().then(createButton);
        }
    });
})();
