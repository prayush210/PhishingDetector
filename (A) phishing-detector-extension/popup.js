// popup.js

// Get references to the DOM elements
const scanButton = document.getElementById('scanButton');
const statusContainer = document.getElementById('statusContainer');
const statusTextSpan = statusContainer.querySelector('span'); // Assumes the text is within a span inside statusContainer
const recommendationsArea = document.getElementById('recommendationsArea');

/**
 * Updates the UI elements based on the current state of the scan.
 * @param {string} state - The current state (e.g., 'IDLE', 'SCANNING', 'SUCCESS', 'ERROR').
 * @param {object} [data] - Optional data associated with the state (e.g., result message or error message).
 */
function updateUI(state, data) {
  // Reset recommendations and base styles for status container
  recommendationsArea.classList.add('hidden');
  // Reset all possible status classes before applying the new one
  statusContainer.className = 'statusContainer'; // Base class if you define one, or just clear previous status-specific ones

  scanButton.disabled = false;
  scanButton.classList.remove('opacity-70', 'cursor-not-allowed'); // Assuming these are for disabled state

  switch (state) {
    case 'IDLE':
      statusTextSpan.textContent = 'Status: Ready';
      statusContainer.classList.add('status-ready');
      break;
    case 'SCANNING':
      statusTextSpan.textContent = 'Status: Scanning...';
      statusContainer.classList.add('status-scanning');
      scanButton.disabled = true;
      scanButton.classList.add('opacity-70', 'cursor-not-allowed'); // Example disabled style
      break;
    case 'SUCCESS':
      let message = '';
      let resultType = data && data.resultType ? data.resultType.toUpperCase() : 'UNKNOWN';
      let cssClass = '';

      switch (resultType) {
        case 'SAFE':
          message = 'Email appears SAFE';
          cssClass = 'status-safe';
          break;
        case 'PHISHING':
          message = 'Potential PHISHING detected!';
          cssClass = 'status-phishing';
          recommendationsArea.classList.remove('hidden');
          break;
        default:
          message = `Scan complete: Unknown result (${resultType})`;
          cssClass = 'status-error';
      }
      statusTextSpan.textContent = message;
      statusContainer.classList.add(cssClass);
      break;
    case 'ERROR':
      statusTextSpan.textContent = `Error: ${data && data.message ? data.message : 'Unknown error'}`;
      statusContainer.classList.add('status-error');
      break;
    default:
      statusTextSpan.textContent = 'Status: Unknown state';
      statusContainer.classList.add('status-ready'); // Default to ready or a specific unknown style
  }
}

// Add event listener for the button click
scanButton.addEventListener('click', async () => {
  updateUI('SCANNING');

  try {
    // Find the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].id) {
      console.error("Could not get active tab information.");
      throw new Error("Could not access the active tab. Ensure a tab is active and focused.");
    }
    const activeTabId = tabs[0].id;

    // Send a message to the content script in that tab
    const response = await chrome.tabs.sendMessage(activeTabId, { action: "scanEmail" });

    // Check for errors after sending the message (e.g., if content script doesn't exist on the page)
    if (chrome.runtime.lastError) {
      console.error("Error sending message to content script:", chrome.runtime.lastError.message);
      throw new Error(`Communication error: ${chrome.runtime.lastError.message}. Is Gmail open and the extension reloaded?`);
    }

    // Process the response from the content script
    console.log("Response from content script:", response);

    if (response && response.result) {
      // Assuming response.result is a string: "SAFE", "PHISHING"
      updateUI('SUCCESS', { resultType: response.result });
    } else if (response && response.error) {
      updateUI('ERROR', { message: response.error });
    } else {
      // This case handles undefined response or response without 'result' or 'error'
      updateUI('ERROR', { message: 'Received an invalid or empty response from the content script.' });
    }

  } catch (error) {
    console.error('Error in popup.js during scan:', error);
    // Ensure a user-friendly message is displayed
    const friendlyMessage = (error && error.message) ? error.message : 'An unexpected error occurred during the scan.';
    updateUI('ERROR', { message: friendlyMessage });
  }
});

// Set initial UI state when the popup loads
document.addEventListener('DOMContentLoaded', () => {
    updateUI('IDLE');
});
