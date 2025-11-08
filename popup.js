const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');

startBtn.addEventListener('click', async () => {
  status.textContent = 'Starting...';
  // Send message to content script in active tab
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if(!tab) { status.textContent = 'No active tab'; return; }
  chrome.tabs.sendMessage(tab.id, {action: 'startDelete'});
  startBtn.disabled = true;
  stopBtn.disabled = false;
  status.textContent = 'Deleting... (check the tab)';

});

stopBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if(!tab) return;
  chrome.tabs.sendMessage(tab.id, {action: 'stopDelete'});
  stopBtn.disabled = true;
  startBtn.disabled = false;
  status.textContent = 'Stop requested';
});

// Listen for updates from content script
chrome.runtime.onMessage.addListener((msg) => {
  if(msg.type === 'status') {
    status.textContent = msg.text;
    if(msg.disableStart) {
      startBtn.disabled = true;
      stopBtn.disabled = false;
    }
    if(msg.done) {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }
});
