/* ─────────────────────────────────────────────
   QuickNote — content.js (Floating Site-Pin Button)
   ───────────────────────────────────────────── */

(function () {
    const HOST = location.hostname;
    if (!HOST) return;

    let btnEl = null;
    let closedForSession = false;  // user dismissed for this page load

    function getSitePinnedCount() {
        return new Promise(resolve => {
            chrome.storage.local.get(['qn_notes', 'qn_settings'], data => {
                const settings = data.qn_settings || {};
                if (!settings.tabPinEnabled || settings.floatingButtonEnabled === false) {
                    resolve(0); return;
                }
                const notes = data.qn_notes || [];
                resolve(notes.filter(n => n.pinnedUrl === HOST).length);
            });
        });
    }

    function createButton(count) {
        if (btnEl) { btnEl.remove(); btnEl = null; }
        if (count === 0 || closedForSession) return;

        // Container
        btnEl = document.createElement('div');
        btnEl.id = 'quicknote-site-pin-btn';
        btnEl.setAttribute('style', `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 0;
      user-select: none;
    `);

        // Main button
        const main = document.createElement('div');
        main.setAttribute('style', `
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #FF7BAC, #D95C8C);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      box-shadow: 0 4px 16px rgba(200,80,140,.45);
      font-family: 'Segoe UI', sans-serif;
      font-size: 18px;
      font-weight: 800;
      transition: box-shadow .15s;
      position: relative;
    `);
        main.textContent = '🗒';
        main.title = `${count} QuickNote${count !== 1 ? 's' : ''} pinned to this site`;

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
        main.appendChild(badge);

        // Close button
        const close = document.createElement('div');
        close.setAttribute('style', `
      position: absolute;
      top: -6px;
      left: -6px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #444;
      color: #fff;
      font-size: 10px;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,.3);
      line-height: 1;
    `);
        close.textContent = '✕';
        close.title = 'Hide for this session';
        main.appendChild(close);

        // Show close on hover
        main.addEventListener('mouseenter', () => {
            close.style.display = 'flex';
            main.style.boxShadow = '0 6px 24px rgba(200,80,140,.6)';
        });
        main.addEventListener('mouseleave', () => {
            close.style.display = 'none';
            main.style.boxShadow = '0 4px 16px rgba(200,80,140,.45)';
        });

        // Close handler
        close.addEventListener('click', e => {
            e.stopPropagation();
            closedForSession = true;
            btnEl.remove();
            btnEl = null;
        });

        // ── DRAG LOGIC ──
        let isDragging = false;
        let wasDragged = false;
        let startX, startY, startLeft, startBottom;

        main.addEventListener('mousedown', e => {
            if (e.target === close) return;
            isDragging = true;
            wasDragged = false;
            main.style.cursor = 'grabbing';
            main.style.transition = 'none';

            const rect = btnEl.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startBottom = window.innerHeight - rect.bottom;

            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragged = true;

            const newLeft = startLeft + dx;
            const newBottom = startBottom - dy;

            btnEl.style.left = `${Math.max(0, Math.min(newLeft, window.innerWidth - 56))}px`;
            btnEl.style.bottom = `${Math.max(0, Math.min(newBottom, window.innerHeight - 56))}px`;
            btnEl.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            main.style.cursor = 'grab';
        });

        // Click → open popup (only if not dragged)
        main.addEventListener('click', () => {
            if (wasDragged) return;
            chrome.runtime.sendMessage({ action: 'openQuickNoteList' });
        });

        btnEl.appendChild(main);
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
