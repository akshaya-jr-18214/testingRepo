/* ── Popup Script ─────────────────────────────────────── */

const serviceEl      = document.getElementById('service');
const parentBranchEl = document.getElementById('parentBranch');
const childBranchEl  = document.getElementById('childBranch');
const scrollDateEl   = document.getElementById('scrollUntilDate');
const validateBtn    = document.getElementById('validateBtn');
const statusEl       = document.getElementById('status');
const historySection = document.getElementById('history-section');
const historyList    = document.getElementById('history-list');

// ── Validate button ──────────────────────────────────────
validateBtn.addEventListener('click', () => {
  const service      = serviceEl.value;
  const parentBranch = parentBranchEl.value.trim();
  const childBranch  = childBranchEl.value.trim();
  const scrollUntilDate = scrollDateEl.value || null; // 'YYYY-MM-DD' or null

  if (!parentBranch || !childBranch) {
    showStatus('Please enter both branch names.', 'error');
    return;
  }

  validateBtn.disabled = true;
  showStatus('<span class="spinner"></span> Starting validation…', 'info');

  chrome.runtime.sendMessage(
    { action: 'validate', service, parentBranch, childBranch, scrollUntilDate },
    (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Failed to start validation: ' + chrome.runtime.lastError.message, 'error');
        validateBtn.disabled = false;
        return;
      }
      if (response && response.started) {
        showStatus('<span class="spinner"></span> Extracting commits from parent branch…', 'info');
      }
    }
  );
});

// ── Listen for progress updates from background ──────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'progress') {
    showStatus(`<span class="spinner"></span> ${message.text}`, 'info');
  } else if (message.type === 'done') {
    showStatus('✅ Validation complete! Opening results…', 'success');
    validateBtn.disabled = false;
    loadHistory();
  } else if (message.type === 'error') {
    showStatus('❌ ' + message.text, 'error');
    validateBtn.disabled = false;
  }
});

// ── Status display ───────────────────────────────────────
function showStatus(html, type) {
  statusEl.innerHTML = html;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove('hidden');
}

// ── History ──────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get('validationHistory');
  const history = data.validationHistory || [];

  if (history.length === 0) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');
  historyList.innerHTML = '';

  // Show last 5
  history.slice(-5).reverse().forEach((entry, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="branch-names" title="${entry.parentBranch} vs ${entry.childBranch}">
        ${entry.service}: ${entry.parentBranch} → ${entry.childBranch}
      </span>
      <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
    `;
    li.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'showResult', key: entry.key });
    });
    historyList.appendChild(li);
  });
}

// Load history on popup open
loadHistory();
