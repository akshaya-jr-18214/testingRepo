/* ── Results Page Script ──────────────────────────────── */

(async () => {
  const loadingEl = document.getElementById('loading');
  const errorEl   = document.getElementById('error');
  const errorText = document.getElementById('error-text');
  const resultsEl = document.getElementById('results');

  try {
    // Get the storage key from URL params
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');

    if (!key) {
      showError('No result key provided.');
      return;
    }

    const data = await chrome.storage.local.get(key);
    const report = data[key];

    if (!report) {
      showError('Result not found in storage. It may have been cleared.');
      return;
    }

    // Populate the page
    renderReport(report);

    // Show results, hide loading
    loadingEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');

  } catch (err) {
    showError(err.message);
  }

  function showError(msg) {
    loadingEl.classList.add('hidden');
    errorText.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function renderReport(r) {
    // Header
    // Dynamic heading with service name
    const heading = document.querySelector('h1');
    if (heading && r.service) {
      heading.textContent = `${r.service} Branch Validation Results`;
    }
    document.getElementById('generated-at').textContent =
      `Generated ${new Date(r.generatedAt).toLocaleString()}`;
    document.title = `${r.service || 'Branch'} Validation: ${r.parentBranch} → ${r.childBranch}`;

    // Branch summary cards
    document.getElementById('parent-branch').textContent = r.parentBranch;
    document.getElementById('child-branch').textContent  = r.childBranch;
    document.getElementById('parent-link').href = r.urls.parent;
    document.getElementById('child-link').href  = r.urls.child;

    // Stats
    document.getElementById('stat-parent-rows').textContent    = r.counts.parentRenderedRows;
    document.getElementById('stat-child-rows').textContent     = r.counts.childRenderedRows;
    document.getElementById('stat-parent-commits').textContent = r.counts.parentCommitsParsed;
    document.getElementById('stat-child-commits').textContent  = r.counts.childCommitsParsed;
    document.getElementById('stat-above-common').textContent   = r.counts.parentEntriesAboveCommon;
    document.getElementById('stat-missing').textContent        = r.dedupedMissingIds.length;

    // First common changeset
    const ccEl = document.getElementById('common-changeset-info');
    if (r.firstCommonChangeset) {
      const fc = r.firstCommonChangeset;
      ccEl.innerHTML = `
        <div class="kv"><span class="key">Index in parent</span><span class="val">${fc.indexInParent}</span></div>
        <div class="kv"><span class="key">Changeset</span><span class="val">${esc(fc.changeset)}</span></div>
        <div class="kv"><span class="key">Full hash</span><span class="val">${esc(fc.fullHash)}</span></div>
        <div class="kv"><span class="key">Message</span><span class="val">${esc(fc.message)}</span></div>
        <div class="kv"><span class="key">Task ID</span><span class="val">${fc.id ? esc(fc.id) : '—'}</span></div>
      `;

      // Show verification confirmation (always verified: true when firstCommonChangeset is set)
      if (r.commonVerification) {
        const cv = r.commonVerification;
        let verifyHtml = `<div class="verification verification-pass">`;
        verifyHtml += `<p class="verify-status">✅ Next ${cv.checks.length} changesets match — common point confirmed.</p>`;
        verifyHtml += '<table class="verify-table"><thead><tr><th>#</th><th>Parent</th><th>Child</th><th>Match</th></tr></thead><tbody>';
        cv.checks.forEach(chk => {
          verifyHtml += `<tr>
            <td>+${chk.offset}</td>
            <td class="mono">${chk.parentChangeset ? esc(chk.parentChangeset) : '—'}</td>
            <td class="mono">${chk.childChangeset ? esc(chk.childChangeset) : '—'}</td>
            <td><span class="match-yes">✓</span></td>
          </tr>`;
        });
        verifyHtml += '</tbody></table></div>';
        ccEl.innerHTML += verifyHtml;
      }
    } else if (r.commonVerification && !r.commonVerification.verified) {
      // Candidates were found but none passed the subsequent-entries verification
      const cv = r.commonVerification;
      ccEl.innerHTML = `
        <div class="verification verification-warn">
          <p class="verify-status">⚠️ Common changeset candidates were found but none could be verified
            (the 3-4 entries below did not match between branches).</p>
          <p style="margin:.4rem 0 .6rem;opacity:.75;">Last rejected candidate: <code class="mono">${esc(cv.skippedChangeset || '—')}</code></p>
          <table class="verify-table"><thead><tr><th>#</th><th>Parent</th><th>Child</th><th>Match</th></tr></thead><tbody>
          ${cv.checks.map(chk => `<tr>
            <td>+${chk.offset}</td>
            <td class="mono">${chk.parentChangeset ? esc(chk.parentChangeset) : '—'}</td>
            <td class="mono">${chk.childChangeset ? esc(chk.childChangeset) : '—'}</td>
            <td>${chk.match ? '<span class="match-yes">✓</span>' : '<span class="match-no">✗</span>'}</td>
          </tr>`).join('')}
          </tbody></table>
        </div>`;
    } else {
      ccEl.innerHTML = '<p class="not-found">No common changeset found between the two branches.</p>';
    }

    // Missing IDs
    const missingCountBadge = document.getElementById('missing-count');
    const missingContent    = document.getElementById('missing-ids-content');
    missingCountBadge.textContent = r.dedupedMissingIds.length;
    missingCountBadge.className   = 'badge ' +
      (r.dedupedMissingIds.length === 0 ? 'success' : r.dedupedMissingIds.length <= 5 ? 'warning' : 'danger');

    if (r.dedupedMissingIds.length === 0) {
      missingContent.innerHTML = '<p class="none-msg">All task IDs present in child branch ✓</p>';
    } else {
      missingContent.innerHTML =
        '<div class="id-list">' +
        r.dedupedMissingIds.map(id => `<span class="id-chip">${esc(id)}</span>`).join('') +
        '</div>';
    }

    // Fallback changesets
    const fallbackCountBadge = document.getElementById('fallback-count');
    const fallbackContent    = document.getElementById('fallback-content');
    fallbackCountBadge.textContent = r.fallbackChangesets.length;
    fallbackCountBadge.className   = 'badge ' +
      (r.fallbackChangesets.length === 0 ? 'success' : 'warning');

    if (r.fallbackChangesets.length === 0) {
      fallbackContent.innerHTML = '<p class="none-msg">No fallback changesets ✓</p>';
    } else {
      fallbackContent.innerHTML =
        '<div class="id-list">' +
        r.fallbackChangesets.map(cs => `<span class="id-chip">${esc(cs)}</span>`).join('') +
        '</div>';
    }

    // Full missing details table
    const tbody = document.getElementById('missing-table-body');
    if (r.missing.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#a6e3a1;">No missing entries ✓</td></tr>';
      document.getElementById('select-all-cb').disabled = true;
    } else {
      tbody.innerHTML = r.missing.map((m, idx) => `
        <tr>
          <td class="checkbox-col"><input type="checkbox" class="entry-cb" data-index="${idx}" data-id="${m.id ? esc(m.id) : ''}" data-hash="${m.fullHash ? esc(m.fullHash) : ''}"></td>
          <td>${esc(m.type)}</td>
          <td class="mono">${m.id ? esc(m.id) : '—'}</td>
          <td>${m.author ? esc(m.author) : '—'}</td>
          <td class="mono">${esc(m.changeset)}</td>
          <td>${esc(m.message)}</td>
        </tr>
      `).join('');

      // Show the Zoho CRM action bar
      document.getElementById('zoho-crm-actions').classList.remove('hidden');

      // ── Checkbox handling ──────────────────────────────
      const selectAllCb   = document.getElementById('select-all-cb');
      const selectedCount  = document.getElementById('selected-count');
      const triggerBtn     = document.getElementById('trigger-zoho-btn');
      const notifyBtn      = document.getElementById('notify-btn');
      const copySelectedBtn = document.getElementById('copy-selected-btn');

      function getCheckboxes() {
        return [...tbody.querySelectorAll('.entry-cb')];
      }

      function updateSelectionState() {
        const cbs = getCheckboxes();
        const checkedCbs = cbs.filter(cb => cb.checked);
        const count = checkedCbs.length;
        selectedCount.textContent = `${count} selected`;
        triggerBtn.disabled = count === 0;
        notifyBtn.disabled = count === 0;
        copySelectedBtn.disabled = count === 0;
        selectAllCb.checked = count === cbs.length && cbs.length > 0;
        selectAllCb.indeterminate = count > 0 && count < cbs.length;
      }

      selectAllCb.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        getCheckboxes().forEach(cb => { cb.checked = checked; });
        updateSelectionState();
      });

      tbody.addEventListener('change', (e) => {
        if (e.target.classList.contains('entry-cb')) {
          updateSelectionState();
        }
      });

      // ── Zoho CRM API Trigger ──────────────────────────
      triggerBtn.addEventListener('click', async () => {
        const checkedCbs = getCheckboxes().filter(cb => cb.checked);
        const selectedIds = checkedCbs.map(cb => cb.dataset.id).filter(id => id);
        const selectedHashes = checkedCbs.map(cb => cb.dataset.hash).filter(h => h);

        if (selectedIds.length === 0 && selectedHashes.length === 0) {
          alert('No entries with valid IDs selected.');
          return;
        }

        triggerBtn.disabled = false;
        triggerBtn.textContent = '⏳ Cherry Picking…';

        try {
          await triggerZohoCRMFunction(selectedIds, r.parentBranch, r.childBranch, selectedHashes, r.baseUrl || r.urls.parent.replace(r.parentBranch, ''));
          triggerBtn.textContent = '✓ Cherry Picked!';
          triggerBtn.classList.add('btn-success');
          setTimeout(() => {
            triggerBtn.textContent = '🍒 Cherry Pick the Entries';
            triggerBtn.classList.remove('btn-success');
            updateSelectionState();
          }, 2000);
        } catch (err) {
          triggerBtn.textContent = '✗ Failed';
          triggerBtn.classList.add('btn-error');
          console.error('Zoho CRM API error:', err);
          alert(`Failed to cherry pick entries:\n${err.message}`);
          setTimeout(() => {
            triggerBtn.textContent = '🍒 Cherry Pick the Entries';
            triggerBtn.classList.remove('btn-error');
            updateSelectionState();
          }, 2000);
        }
      });

      // ── Copy Selected IDs button ──────────────────────
      copySelectedBtn.addEventListener('click', () => {
        const selectedIds = getCheckboxes()
          .filter(cb => cb.checked)
          .map(cb => cb.dataset.id)
          .filter(id => id);
        const text = selectedIds.join(',\n');
        navigator.clipboard.writeText(text).then(() => {
          const orig = copySelectedBtn.textContent;
          copySelectedBtn.textContent = '✓ Copied!';
          setTimeout(() => { copySelectedBtn.textContent = orig; }, 1500);
        });
      });

      // ── Send Notification to Owner ─────────────────
      notifyBtn.addEventListener('click', async () => {
        const checkedCbs = getCheckboxes().filter(cb => cb.checked);
        const selectedIds = checkedCbs.map(cb => cb.dataset.id).filter(id => id);
        const selectedHashes = checkedCbs.map(cb => cb.dataset.hash).filter(h => h);

        if (selectedIds.length === 0 && selectedHashes.length === 0) {
          alert('No entries with valid IDs selected.');
          return;
        }

        notifyBtn.disabled = true;
        notifyBtn.textContent = '⏳ Sending Notification…';

        try {
          await sendNotificationToOwner(selectedIds, r.parentBranch, r.childBranch, selectedHashes, r.baseUrl || r.urls.parent.replace(r.parentBranch, ''));
          notifyBtn.textContent = '✓ Notification Sent!';
          notifyBtn.classList.add('btn-success');
          setTimeout(() => {
            notifyBtn.textContent = '🔔 Send Notification to Owner';
            notifyBtn.classList.remove('btn-success');
            updateSelectionState();
          }, 2000);
        } catch (err) {
          notifyBtn.textContent = '✗ Failed';
          notifyBtn.classList.add('btn-error');
          console.error('Zoho CRM Notify error:', err);
          alert(`Failed to send notification:\n${err.message}`);
          setTimeout(() => {
            notifyBtn.textContent = '🔔 Send Notification to Owner';
            notifyBtn.classList.remove('btn-error');
            updateSelectionState();
          }, 2000);
        }
      });
    }

    // ── Action buttons ───────────────────────────────────
    document.getElementById('download-btn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${r.service} Branch Validation Results - ${r.parentBranch} vs ${r.childBranch}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('copy-ids-btn').addEventListener('click', () => {
      const text = r.dedupedMissingIds.join(',\n');
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('copy-ids-btn');
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  }

  /** HTML-escape a string. */
  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Trigger a Zoho CRM custom function via API key.
   * ──────────────────────────────────────────────────────
   */
  async function triggerZohoCRMFunction(missingIds, parentBranch, childBranch, fullHashes, baseUrl) {
    const ZOHO_API_URL = 'https://www.zohoapis.in/crm/v7/functions/send_notification/actions/execute';
    const ZAPI_KEY     = '1003.012b3e63f9093c743af17241bd9140f2.ae80303ac9a3996c592b78ed39c87cd7';

    const url = `${ZOHO_API_URL}?auth_type=apikey&zapikey=${ZAPI_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        arguments: {
          missing_ids:   missingIds.join(','),
          hashCommit:    fullHashes.join(','),
          parent_branch: parentBranch,
          child_branch:  childBranch,
          base_url:      baseUrl,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Send notification to entry owners via Zoho CRM API.
   * ──────────────────────────────────────────────────────
   */
  async function sendNotificationToOwner(missingIds, parentBranch, childBranch, fullHashes, baseUrl) {
    const ZOHO_API_URL = 'https://www.zohoapis.in/crm/v7/functions/test_akshaya/actions/execute';
    const ZAPI_KEY     = '1003.012b3e63f9093c743af17241bd9140f2.ae80303ac9a3996c592b78ed39c87cd7';

    const url = `${ZOHO_API_URL}?auth_type=apikey&zapikey=${ZAPI_KEY}&entry_id=${missingIds.join(',')}&parent_branch=${parentBranch}&child_branch=${childBranch}&hashFullCommit=${fullHashes.join(',')}&gitLink=${baseUrl}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        arguments: {
          missing_ids:   missingIds.join(','),
          hashCommit:    fullHashes.join(','),
          parent_branch: parentBranch,
          child_branch:  childBranch,
          git_link:      baseUrl,
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    return response.json();
  }
})();
