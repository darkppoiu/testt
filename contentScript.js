let stopRequested = false;

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function clickIfExists(el) {
  if(!el) return false;
  try {
    el.scrollIntoView({behavior: 'auto', block: 'center'});
    el.click();
    return true;
  } catch(e) {
    return false;
  }
}

// يحاول العثور على زر القائمة داخل عنصر المنشور (role="article")
function findMenuButtonInArticle(article) {
  // محاولات متعددة للعثور على زر النقاط الثلاث أو زر الخيارات
  const selectors = [
    'div[aria-haspopup="menu"]',
    'div[aria-label="Actions for this post"]',
    'div[aria-label="More"]',
    'div[aria-label*="more"]',
    'div[aria-label*="Options"]',
    'a[aria-label*="more"]',
    'div[role="button"][aria-label*="More"]',
    'div[role="button"] span:contains("More")'
  ];
  // generic approach: find buttons inside article that look like three-dots menu
  const buttons = article.querySelectorAll('div[role="button"], a[role="button"], span[role="button"], button');
  for(const b of buttons){
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    const text = (b.innerText || '').toLowerCase();
    if(aria.includes('more') || aria.includes('actions') || aria.includes('options') || text.trim()==='⋯' || text.includes('more') || text.includes('options')) {
      return b;
    }
    // sometimes the element has an svg and no text/aria - check title attribute
    const title = (b.getAttribute('title') || '').toLowerCase();
    if(title.includes('more') || title.includes('options')) return b;
  }
  return null;
}

async function findAndClickDeleteInMenu() {
  // menu items are usually inside [role="menu"] or divs that appear after clicking menu
  await sleep(600); // wait for menu to open
  const menus = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], div[role="menu"]'));
  for(const menu of menus.reverse()){
    const items = Array.from(menu.querySelectorAll('div, span, a, button')).filter(n => n.innerText && n.innerText.trim().length<80);
    for(const it of items){
      const txt = it.innerText.trim().toLowerCase();
      if(txt.includes('delete') || txt.includes('remove') || txt.includes('delete post') || txt.includes('remove post')) {
        // click it
        it.scrollIntoView({block:'center'});
        it.click();
        return true;
      }
    }
  }
  // try fallback: find button with "Delete" in whole document
  const fallback = Array.from(document.querySelectorAll('button, div, a')).find(n => {
    const t = (n.innerText || '').toLowerCase();
    return t.includes('delete') || t.includes('remove');
  });
  if(fallback) { fallback.click(); return true; }
  return false;
}

async function confirmDeletionIfNeeded() {
  // after clicking delete, there may be a confirmation dialog
  await sleep(700);
  // try to find confirm buttons
  const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a'));
  for(const c of candidates) {
    const t = (c.innerText || '').trim().toLowerCase();
    if(t === 'delete' || t === 'remove' || t === 'confirm' || t === 'yes' || t === 'ok') {
      try {
        c.scrollIntoView({block:'center'});
        c.click();
        return true;
      } catch(e) {}
    }
  }
  return false;
}

async function scrollToLoadMore() {
  window.scrollBy({top: 1000, left:0, behavior:'smooth'});
  await sleep(1000);
}

async function processVisibleArticles(maxPerCycle = 20) {
  const articles = Array.from(document.querySelectorAll('[role="article"]'));
  let processed = 0;
  for(const article of articles) {
    if(stopRequested) return {stopped:true, processed};
    // avoid processing same article twice: mark it
    if(article.dataset.fbcleanerProcessed) continue;
    article.dataset.fbcleanerProcessed = '1';

    const menuBtn = findMenuButtonInArticle(article);
    if(!menuBtn) {
      // skip if cannot find menu
      continue;
    }
    // click menu
    const ok1 = await clickIfExists(menuBtn);
    await sleep(600 + Math.floor(Math.random()*400));
    const ok2 = await findAndClickDeleteInMenu();
    if(!ok2) {
      // close menu (press escape)
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      await sleep(300);
      continue;
    }
    await sleep(700 + Math.floor(Math.random()*500));
    await confirmDeletionIfNeeded();
    processed++;
    // small random delay to mimic human
    await sleep(900 + Math.floor(Math.random()*800));
    if(processed >= maxPerCycle) break;
  }
  return {stopped:false, processed};
}

async function deleteAllPostsLoop() {
  stopRequested = false;
  let totalDeleted = 0;
  let roundsWithoutProgress = 0;
  for(let round=0; round<200 && !stopRequested; round++) {
    // report status
    chrome.runtime.sendMessage({type:'status', text: `Deleting... total deleted: ${totalDeleted}`});
    const res = await processVisibleArticles(15);
    if(res.stopped) {
      chrome.runtime.sendMessage({type:'status', text: `Stopped by user. Total deleted: ${totalDeleted}`, done:true});
      return;
    }
    if(res.processed === 0) {
      roundsWithoutProgress++;
    } else {
      totalDeleted += res.processed;
      roundsWithoutProgress = 0;
    }
    // if no progress for a few rounds, try scrolling to load more
    if(roundsWithoutProgress >= 2) {
      await scrollToLoadMore();
    }
    // if no progress for many rounds, quit
    if(roundsWithoutProgress >= 6) break;
    await sleep(800 + Math.floor(Math.random()*600));
  }
  chrome.runtime.sendMessage({type:'status', text: `Finished. Approx. deleted: ${totalDeleted}`, done:true});
}

// message listener: start or stop
chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
  if(msg.action === 'startDelete') {
    // confirm we are in a group URL
    if(!location.href.includes('/groups/')) {
      chrome.runtime.sendMessage({type:'status', text: 'Not on a Facebook group page. Navigate to the group posts page first.', done:true});
      return;
    }
    chrome.runtime.sendMessage({type:'status', text: 'Starting deletion...', disableStart:true});
    deleteAllPostsLoop();
  } else if(msg.action === 'stopDelete') {
    stopRequested = true;
  }
});
