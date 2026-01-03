/**
 * Talio Activity Monitor - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Get session info
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SESSION' });
    
    if (response && response.session) {
      document.getElementById('session-id').textContent = response.session.substring(0, 20) + '...';
      
      if (response.user) {
        document.getElementById('user-info').style.display = 'block';
        document.getElementById('user-email').textContent = response.user.email;
      }
    } else {
      document.getElementById('tracking-status').textContent = 'Inactive';
      document.getElementById('tracking-status').classList.remove('badge-active');
      document.getElementById('tracking-status').classList.add('badge-inactive');
      document.getElementById('session-id').textContent = 'Not tracking';
    }
  } catch (error) {
    console.error('Failed to get session info:', error);
  }
  
  // Get stats from storage
  chrome.storage.local.get(['activityStats'], (result) => {
    if (result.activityStats) {
      const stats = result.activityStats;
      document.getElementById('keystroke-count').textContent = stats.keystrokes || 0;
      document.getElementById('click-count').textContent = stats.clicks || 0;
      document.getElementById('window-count').textContent = stats.windows || 0;
      document.getElementById('screenshot-count').textContent = stats.screenshots || 0;
    }
  });
  
  // Dashboard button
  document.getElementById('dashboard-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://app.tailo.work/dashboard/mira/activity-history' });
  });
  
  // Pause button
  document.getElementById('pause-btn').addEventListener('click', () => {
    // TODO: Implement pause functionality
    alert('Pause functionality coming soon!');
  });
});
