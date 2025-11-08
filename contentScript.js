// contentScript.js - improved version with robust selectors, MutationObserver and verbose logging

let stopRequested = false;
const processedSet = new WeakSet();

function log(msg, obj) {
  console.log(`[FB-CLEANER] ${msg}`, obj || '');
  try { chrome.runtime.sendMessage({type:'status', text: msg}); } catch(e) {}
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function clickElement(el) {
  if(!el) return false;
  try {
    el.scrollIntoView({behavior:'auto', block:'center'});
    // try multiple click methods
    el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
    await sleep(80);
    el.click();
    return true;
  } catch(e) {
    try { el.click(); return true; } catch(e2) { return false; }
  }
}

// Robust way to find menu button inside an article
function findMenuButtonInArticle(article) {
  // avoid previously processed
  if(!article) return null;
  // common patterns: a button with aria-haspopup, aria-label containing "more", a div with role="button" and svg of three dots
  const btnSelectors = [
    'div[aria-haspopup="menu"][role="button"]',
    'div[role="button"][aria-label*="More"]',
    'div[role="button"][aria-label*="Actions"]',
    'div[role="button"][aria-label*="more"]',
    'div[role="button"] a[aria-label*="More"]',
    'a[role="button"][aria-label*="More"]',
    'div[aria-label*="Actions for this post"]',
    'div[aria-label*="See more"]',
    'div[aria-label*="Post Options"]',
    'div[aria-label*="Options"]'
  ];
  for(const s of btnSelectors) {
    const el = article.querySelector(s);
    if(el) return el;
  }

  // fallback: search for any clickable element with svg of three dots or text '...' or 'More'
  const candidates = Array.from(article.querySelectorAll('div[role="button"], a[role="button"], button'));
  for(const c of candidates) {
    const aria = (c.getAttribute('aria-label') || '').toLowerCase();
    const title = (c.getAttribute('title') || '').toLowerCase();
    const txt = (c.innerText || '').trim().toLowerCase();
    if(aria.includes('more') || aria.includes('actions') || title.includes('more') || txt === '⋯' || txt === '...' || txt.includes('more') ) return c;
    // check svg path for three dots clue (loose check)
    if(c.querySelector('svg') && (txt.length === 0)) {
      // accept as fallback
      // return c; // don't return immediately, prefer matches above
    }
  }
  return null;
}

async function openMenuAndDelete(article) {
  // 1) find menu button
  const menuBtn = findMenuButtonInArticle(article);
  if(!menuBtn) { log('No menu button found for an article'); return false; }
  const clickedMenu = await clickElement(menuBtn);
  if(!clickedMenu) {
    log('Failed to click menu button'); return false;
  }
  // wait menu to appear
  await sleep(500 + Math.floor(Math.random()*400));

  // 2) find delete/remove item in any visible menu/dialog
  // look for role="menu" or dialog elements recently added in document body
  const menuCandidates = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="menuitem"], div[role="listbox"], div[role="menu"]'));
  // reverse to check most recently added first
  for(const menu of menuCandidates.reverse()) {
    // gather clickable items
    const items = Array.from(menu.querySelectorAll('div, button, a, span')).filter(n => n.innerText && n.innerText.trim().length < 60);
    for(const it of items) {
      const t = it.innerText.trim().toLowerCase();
      if(t.includes('delete') || t.includes('remove') || t.includes('delete post') || t.includes('remove post') || t.includes('delete photo')) {
        await clickElement(it);
        await sleep(400 + Math.floor(Math.random()*300));
        // confirm if dialog shows
        await confirmIfDialog();
        return true;
      }
    }
  }

  // fallback broad scan on entire document for visible buttons named delete/remove
  const globalBtns = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
  for(const g of globalBtns) {
    const t = (g.innerText || '').trim().toLowerCase();
    if(t === 'delete' || t === 'remove' || t === 'delete post' || t === 'remove post') {
      await clickElement(g);
      await sleep(300);
      await confirmIfDialog();
      return true;
    }
  }

  // if nothing found, try pressing Escape to close menu (cleanup)
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  await sleep(150);
  return false;
}

async function confirmIfDialog() {
  await sleep(350 + Math.floor(Math.random()*300));
  // find typical confirm buttons in dialog
  const confirmCandidates = Array.from(document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] a, button, a')).filter(n => n.innerText && n.innerText.trim().length < 30);
  for(const c of confirmCandidates) {
    const t = c.innerText.trim().toLowerCase();
    if(t === 'delete' || t === 'remove' || t === 'confirm' || t === 'ok' || t === 'yes') {
      await clickElement(c);
      await sleep(300 + Math.floor(Math.random()*300));
      return true;
    }
  }
  // no explicit confirm found — maybe deletion is immediate
  return false;
}

async function processOneArticle(article) {
  if(!article || processedSet.has(article)) return false;
  processedSet.add(article);
  if(stopRequested) return false;

  // try to delete
  try {
    log('Processing article', article);
    const ok = await openMenuAndDelete(article);
    if(ok) {
      log('Deleted (or attempted) an article');
      return true;
    } else {
      log('Could not find delete action for this article');
      return false;
    }
  } catch(e) {
    console.error('[FB-CLEANER] error processing article', e);
    return false;
  }
}

async function processVisibleArticlesBatch(max = 10) {
  const articles = Array.from(document.querySelectorAll('[role="article"]'));
  let count = 0;
  for(const a of articles) {
    if(stopRequested) return {stopped:true, processed:count};
    if(processedSet.has(a)) continue;
    const res = await processOneArticle(a);
    if(res) count++;
    // small human-like pause
    await sleep(600 + Math.floor(Math.random()*600));
    if(count >= max) break;
  }
  return {stopped:false, processed:count};
}

async function scrollAndWait() {
  window.scrollBy({top: 1200, left:0, behavior:'smooth'});
  await sleep(900 + Math.floor(Math.random()*400));
}

async function deleteLoop() {
  stopRequested = false;
  let total = 0;
  let idleRounds = 0;
  for(let i=0; i<300 && !stopRequested; i++) {
    log(`Loop #${i+1} — total deleted so far: ${total}`);
    const res = await processVisibleArticlesBatch(12);
    if(res.stopped) { log('Stopped by user'); break; }
    if(res.processed === 0) {
      idleRounds++;
      await scrollAndWait();
    } else {
      total += res.processed;
      idleRounds = 0;
    }
    if(idleRounds >= 6) {
      log('No progress after several attempts — stopping');
      break;
    }
    await sleep(700 + Math.floor(Math.random()*600));
  }
  log(`Finished loop. Approx total deleted: ${total}`);
  try { chrome.runtime.sendMessage({type:'status', text:`Finished. Approx deleted: ${total}`, done:true}); } catch(e) {}
}

// Listen for messages (start / stop)
chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if(msg && msg.action === 'startDelete') {
    if(!location.href.includes('/groups/')) {
      log('Not a group URL. Navigate to the group posts page and try again.');
      try { chrome.runtime.sendMessage({type:'status', text:'Not on a Facebook group page. Navigate to the group first.', done:true}); } catch(e){}
      return;
    }
    log('Start requested — initiating delete loop');
    deleteLoop();
  } else if(msg && msg.action === 'stopDelete') {
    stopRequested = true;
    log('Stop requested by popup');
  }
});

// MutationObserver to mark new articles and optionally auto-process if running
const observer = new MutationObserver((mutations) => {
  // do lightweight scanning only
  for(const m of mutations) {
    if(m.addedNodes && m.addedNodes.length) {
      for(const n of m.addedNodes) {
        if(n && n.querySelector && n.querySelector('[role="article"]')) {
          // small log
          // console.log('[FB-CLEANER] new article nodes added');
        }
      }
    }
  }
});
observer.observe(document.body, {childList:true, subtree:true});

// Expose small API to window for manual testing in console
window.fbCleaner = {
  start: () => { chrome.runtime.sendMessage({type:'status', text:'Manual start from console'}); deleteLoop(); },
  stop: () => { stopRequested = true; log('Manual stop via window.fbCleaner.stop()'); },
  status: () => { console.log('stopRequested=', stopRequested); }
};

log('contentScript loaded. Ready.');
