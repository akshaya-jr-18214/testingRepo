/* ── Background Service Worker ────────────────────────── */

/**
 * Service-to-URL mapping — mirrors the original CLI tool's switch/case.
 */
const SERVICE_URLS = {
  CRM:                 'https://zgit.csez.zohocorpin.com/CRM/zohocrm/-/commits/',
  BIGIN:               'https://git.csez.zohocorpin.com/CRM/ignite/-/commits/',
  CRMINTELLIGENCE:     'https://git.csez.zohocorpin.com/CRM/crmintelligence/-/commits/',
  CRMINTELLIGENCEPY:   'https://git.csez.zohocorpin.com/CRM/CrmIntelligencePy/-/commits/',
  COMMANDCENTER:       'https://git.csez.zohocorpin.com/zohocommandcenter/zohocommandcenter/-/commits/',
  PLATFORM:            'https://zgit.csez.zohocorpin.com/CRM/zohocrm/-/commits/',
  PHONEBRIDGEPLATFORM: 'https://repository.zohocorpcloud.in/zohocorp/PhoneBridge/PhoneBridgePlatform#/commits/',
};

// ── Message router ───────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'validate') {
    // Start validation asynchronously
    runValidation(message.service, message.parentBranch, message.childBranch, message.scrollUntilDate);
    sendResponse({ started: true });
    return false; // synchronous response
  }

  if (message.action === 'showResult') {
    openResultsPage(message.key);
    sendResponse({ ok: true });
    return false;
  }
});

// ── Main validation flow ─────────────────────────────────
async function runValidation(service, parentBranch, childBranch, scrollUntilDate) {
  const base = SERVICE_URLS[service];
  if (!base) {
    broadcastToPopup({ type: 'error', text: `Unknown service: ${service}` });
    return;
  }

  if (parentBranch === childBranch) {
    broadcastToPopup({ type: 'error', text: 'Both branches are the same. Kindly give different branches.' });
    return;
  }

  let parentTabId = null;
  let childTabId = null;

  try {
    const branchType = getBranchType(parentBranch, childBranch);
    const parentUrl = base + parentBranch;
    const childUrl = base + childBranch;

    // ── Phase 1: Quick extraction (~500 commits) to check for common changeset ──
    broadcastToPopup({ type: 'progress', text: 'Phase 1: Quick-loading parent branch…' });

    const parentTab1 = await chrome.tabs.create({ url: parentUrl, active: true });
    parentTabId = parentTab1.id;
    await waitForTabLoad(parentTabId);
    await sleep(2000);

    broadcastToPopup({ type: 'progress', text: 'Phase 1: Extracting first ~500 commits from parent…' });
    let parentData = await sendMessageToTab(parentTabId, { action: 'extractCommits', branchType, scrollMode: 'quick', scrollUntilDate });

    if (parentData.error) {
      broadcastToPopup({ type: 'error', text: `Parent branch: ${parentData.error}` });
      return;
    }

    safeCloseTab(parentTabId);
    parentTabId = null;

    broadcastToPopup({ type: 'progress', text: 'Phase 1: Quick-loading child branch…' });

    const childTab1 = await chrome.tabs.create({ url: childUrl, active: true });
    childTabId = childTab1.id;
    await waitForTabLoad(childTabId);
    await sleep(2000);

    broadcastToPopup({ type: 'progress', text: 'Phase 1: Extracting first ~500 commits from child…' });
    let childData = await sendMessageToTab(childTabId, { action: 'extractCommits', branchType, scrollMode: 'quick', scrollUntilDate });

    if (childData.error) {
      broadcastToPopup({ type: 'error', text: `Child branch: ${childData.error}` });
      return;
    }

    safeCloseTab(childTabId);
    childTabId = null;

    // ── Check if a common changeset exists ──
    const hasCommon = hasCommonChangeset(parentData.commits, childData.commits);

    if (!hasCommon) {
      // ── Phase 2: Full extraction — no common changeset found, load more history ──
      broadcastToPopup({ type: 'progress', text: 'No common changeset in first ~500. Phase 2: Full loading parent…' });

      const parentTab2 = await chrome.tabs.create({ url: parentUrl, active: true });
      parentTabId = parentTab2.id;
      await waitForTabLoad(parentTabId);
      await sleep(2000);

      broadcastToPopup({ type: 'progress', text: 'Phase 2: Extracting all commits from parent…' });
      parentData = await sendMessageToTab(parentTabId, { action: 'extractCommits', branchType, scrollMode: 'full', scrollUntilDate });

      if (parentData.error) {
        broadcastToPopup({ type: 'error', text: `Parent branch (full): ${parentData.error}` });
        return;
      }

      safeCloseTab(parentTabId);
      parentTabId = null;

      broadcastToPopup({ type: 'progress', text: 'Phase 2: Full loading child branch…' });

      const childTab2 = await chrome.tabs.create({ url: childUrl, active: true });
      childTabId = childTab2.id;
      await waitForTabLoad(childTabId);
      await sleep(2000);

      broadcastToPopup({ type: 'progress', text: 'Phase 2: Extracting all commits from child…' });
      childData = await sendMessageToTab(childTabId, { action: 'extractCommits', branchType, scrollMode: 'full', scrollUntilDate });

      if (childData.error) {
        broadcastToPopup({ type: 'error', text: `Child branch (full): ${childData.error}` });
        return;
      }

      safeCloseTab(childTabId);
      childTabId = null;
    }

    // ── Build report ──
    broadcastToPopup({ type: 'progress', text: 'Building comparison report…' });
    const report = buildReport(
      { branch: parentBranch, url: parentUrl, ...parentData },
      { branch: childBranch, url: childUrl, ...childData },
      parentBranch,
      childBranch,
      base,
      service
    );

    // 5 — Store result
    const key = `result_${Date.now()}`;
    await chrome.storage.local.set({ [key]: report, lastResultKey: key });

    // Save to history
    const histData = await chrome.storage.local.get('validationHistory');
    const history = histData.validationHistory || [];
    history.push({
      key,
      service,
      parentBranch,
      childBranch,
      timestamp: new Date().toISOString(),
      missingCount: report.dedupedMissingIds.length,
    });
    // Keep last 100
    if (history.length > 100) history.splice(0, history.length - 100);
    await chrome.storage.local.set({ validationHistory: history });

    // 6 — Open results page
    broadcastToPopup({ type: 'done' });
    openResultsPage(key);

  } catch (err) {
    broadcastToPopup({ type: 'error', text: err.message || 'Validation failed.' });
  } finally {
    if (parentTabId) safeCloseTab(parentTabId);
    if (childTabId) safeCloseTab(childTabId);
  }
}

// ── Build the comparison report (ported from CLI) ────────
function buildReport(parentData, childData, parentBranch, childBranch, base, service) {
  const parent = parentData.commits || [];
  const child  = childData.commits  || [];

  const childChangesets = new Set(child.map(c => c.changeset));

  // ── Find a verified common changeset ──
  // Only accept a common changeset if the next 3-4 entries below it also match.
  const VERIFY_COUNT = 4;
  let firstCommonIdx = -1;
  let firstCommon    = null;
  let commonVerification = null;

  let searchFrom = 0;
  while (searchFrom < parent.length) {
    const candidateIdx = parent.findIndex((p, i) => i >= searchFrom && childChangesets.has(p.changeset));
    if (candidateIdx < 0) break; // no more candidates

    const candidate = parent[candidateIdx];
    const childCommonIdx = child.findIndex(c => c.changeset === candidate.changeset);

    const checks = [];
    let allMatch = true;

    for (let i = 1; i <= VERIFY_COUNT; i++) {
      const parentEntry = parent[candidateIdx + i];
      const childEntry  = childCommonIdx >= 0 ? child[childCommonIdx + i] : null;

      if (!parentEntry && !childEntry) break; // both ran out

      const match = !!(parentEntry && childEntry && parentEntry.changeset === childEntry.changeset);
      if (!match) allMatch = false;

      checks.push({
        offset: i,
        parentChangeset: parentEntry ? parentEntry.changeset : null,
        childChangeset:  childEntry  ? childEntry.changeset  : null,
        parentMessage:   parentEntry ? parentEntry.message   : null,
        childMessage:    childEntry  ? childEntry.message    : null,
        match,
      });
    }

    if (allMatch) {
      // Verified — accept this as the real common changeset
      firstCommonIdx = candidateIdx;
      firstCommon    = candidate;
      commonVerification = { verified: true, checks };
      break;
    } else {
      // Verification failed — skip this candidate and keep searching
      commonVerification = { verified: false, checks, skippedChangeset: candidate.changeset };
      searchFrom = candidateIdx + 1;
    }
  }

  const parentAbove = firstCommonIdx > 0 ? parent.slice(0, firstCommonIdx) : [];
  const childIds    = new Set(child.map(c => c.id).filter(Boolean));

  const missing = [];
  for (const entry of parentAbove) {
    if (entry.id) {
      if (!childIds.has(entry.id)) {
        missing.push({ type: 'id', id: entry.id, changeset: entry.changeset, fullHash: entry.fullHash, message: entry.message, author: entry.author || null });
      }
    } else {
      missing.push({ type: 'changeset', changeset: entry.changeset, fullHash: entry.fullHash, message: entry.message, author: entry.author || null });
    }
  }

  return {
    mode: `${service} Branch Validation`,
    service,
    generatedAt: new Date().toISOString(),
    parentBranch,
    childBranch,
    baseUrl: base,
    urls: {
      parent: base + parentBranch,
      child:  base + childBranch,
    },
    counts: {
      parentRenderedRows:    parentData.renderedRowCount,
      childRenderedRows:     childData.renderedRowCount,
      parentCommitsParsed:   parent.length,
      childCommitsParsed:    child.length,
      parentEntriesAboveCommon: parentAbove.length,
    },
    firstCommonChangeset: firstCommon
      ? {
          indexInParent: firstCommonIdx,
          changeset:     firstCommon.changeset,
          fullHash:      firstCommon.fullHash,
          message:       firstCommon.message,
          id:            firstCommon.id,
        }
      : null,
    commonVerification,
    missing,
    dedupedMissingIds:   [...new Set(missing.filter(m => m.type === 'id').map(m => m.id))],
    fallbackChangesets:  missing.filter(m => m.type === 'changeset').map(m => m.changeset),
  };
}

// ── Helpers ──────────────────────────────────────────────

/** Send a message to a tab's content script with retries. */
async function sendMessageToTab(tabId, message, maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('Could not reach content script. Make sure you are logged in to GitLab.');
}

/**
 * Check if parent and child commit lists share at least one common changeset.
 */
function hasCommonChangeset(parentCommits, childCommits) {
  if (!parentCommits || !childCommits) return false;
  const childChangesets = new Set(childCommits.map(c => c.changeset));
  return parentCommits.some(p => childChangesets.has(p.changeset));
}

/** Wait for a tab to finish loading. */
function waitForTabLoad(tabId, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out.'));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

/** Broadcast a message to all extension views (popup). */
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed — that's fine.
  });
}

/** Open the results page for a given storage key. */
function openResultsPage(key) {
  const url = chrome.runtime.getURL(`results/results.html?key=${key}`);
  chrome.tabs.create({ url });
}

/** Close a tab safely. */
function safeCloseTab(tabId) {
  chrome.tabs.remove(tabId).catch(() => {});
}

/**
 * Determine branch type based on RB/DB patterns.
 * - 'cross'  → one branch has RB1_RB and the other has DB1_RB (different types, need more history)
 * - 'same'   → both have the same type (RB1_RB + RB1_RB or DB1_RB + DB1_RB, need less history)
 */
function getBranchType(branchA, branchB) {
  const hasRB = (b) => /RB\d*_RB/i.test(b);
  const hasDB = (b) => /DB\d*_RB/i.test(b);

  const aIsRB = hasRB(branchA);
  const aIsDB = hasDB(branchA);
  const bIsRB = hasRB(branchB);
  const bIsDB = hasDB(branchB);

  // Cross-type: one RB + one DB → need more scrolling
  if ((aIsRB && bIsDB) || (aIsDB && bIsRB)) return 'cross';

  // Same type: both RB or both DB → less scrolling
  return 'same';
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
