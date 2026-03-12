/* ── Content Script ───────────────────────────────────── */
/* Injected into GitLab pages. Listens for extraction requests from the
   background service worker and scrapes commit data from the DOM.         */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'extractCommits') {
    extractCommits(message.branchType, message.scrollMode, message.scrollUntilDate)
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep the message channel open for async response
  }
});

async function extractCommits(branchType = 'same', scrollMode = 'full', scrollUntilDate = null) {
  // ── Wait for commits to appear (user may need to log in) ───────────
  const MAX_WAIT = 60000; // 60 seconds
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    if (document.querySelectorAll('li.commit').length > 0) break;
    await sleep(500);
  }

  if (document.querySelectorAll('li.commit').length === 0) {
    return { error: 'No commits found. Please make sure you are logged in to GitLab.' };
  }

  // ── Scroll to load all lazy-loaded commits ─────────────────────────
  let stableRounds = 0;
  let previousCount = 0;

  let maxIterations, stableLimit, scrollDelay;

  if (scrollMode === 'quick') {
    // Phase 1: Quick pass — load ~500 commits to check for common changeset
    maxIterations = 60;
    stableLimit   = 5;
    scrollDelay   = 600;
  } else {
    // Phase 2 / Full pass — based on branch type
    const isCross = branchType === 'cross';
    maxIterations = isCross ? 150 : 50;
    stableLimit   = isCross ? 8   : 5;
    scrollDelay   = isCross ? 800 : 600;
  }

  // Parse the cutoff date if provided
  const cutoffDate = scrollUntilDate ? new Date(scrollUntilDate + 'T00:00:00') : null;

  /**
   * Check if the last visible commit's date is older than the cutoff.
   * GitLab shows dates in elements like `time[datetime]` or `.commit-timeago time`.
   */
  function hasReachedDateCutoff() {
    if (!cutoffDate) return false;
    const commitItems = document.querySelectorAll('li.commit');
    if (commitItems.length === 0) return false;
    const lastCommit = commitItems[commitItems.length - 1];
    const timeEl = lastCommit.querySelector('time[datetime]');
    if (!timeEl) return false;
    const commitDate = new Date(timeEl.getAttribute('datetime'));
    return commitDate < cutoffDate;
  }

  for (let i = 0; i < maxIterations; i++) {
    const currentCount = document.querySelectorAll('li.commit').length;
    if (currentCount === previousCount) stableRounds++;
    else stableRounds = 0;

    previousCount = currentCount;
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(scrollDelay);

    if (stableRounds >= stableLimit) break;
    if (hasReachedDateCutoff()) break;
  }

  // ── Expand commit details (toggle buttons) ─────────────────────────
  document.querySelectorAll('li.commit button.js-toggle-button').forEach(btn => btn.click());
  await sleep(500);

  // ── Parse commits from DOM ─────────────────────────────────────────
  const parseId = (text) => {
    if (!text) return null;
    const match = text.match(/1034\d{8,}/);
    return match ? match[0] : null;
  };

  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();

  const rows = Array.from(document.querySelectorAll('li.commit'));

  const commits = rows
    .map((li, index) => {
      const main = li.querySelector('a.commit-row-message[href*="/-/commit/"]');
      const href = main ? main.getAttribute('href') || '' : '';
      const fullHash = (href.match(/\/-\/commit\/([0-9a-f]{7,40})/i) || [])[1] || '';
      if (!fullHash) return null;

      const message   = normalize(main ? main.textContent : '');
      const title     = normalize(main ? main.getAttribute('title') : '');
      const detailsText = normalize(li.querySelector('.js-toggle-content')?.textContent || '');
      const allText   = normalize(li.textContent || '');

      // Extract author from DOM
      const authorEl = li.querySelector('.commit-author-link')
                    || li.querySelector('.author-link')
                    || li.querySelector('.commit-author-name')
                    || li.querySelector('[data-testid="commit-author-link"]');
      const author = normalize(authorEl ? authorEl.textContent : '') || null;

      // Extract commit date from DOM
      const timeEl = li.querySelector('time[datetime]');
      const commitDate = timeEl ? timeEl.getAttribute('datetime') : null;

      const id = parseId(message) || parseId(title) || parseId(detailsText) || parseId(allText);

      // Skip commits older than the cutoff date
      if (cutoffDate && commitDate) {
        const d = new Date(commitDate);
        if (d < cutoffDate) return null;
      }

      return {
        index,
        fullHash,
        changeset: fullHash.slice(0, 5),
        message,
        id,
        author,
        commitDate,
      };
    })
    .filter(Boolean);

  return {
    renderedRowCount: rows.length,
    commits,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
