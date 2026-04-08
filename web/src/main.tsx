import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Suppress Google Maps billing error dialog globally
// 1. Override window.gm_authFailure which Google calls on key issues
(window as any).gm_authFailure = () => {};

// 2. MutationObserver to catch and remove error dialogs
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        // Google Maps error dialog
        if (node.getAttribute?.('role') === 'dialog' ||
            node.classList?.contains('gm-err-container') ||
            node.classList?.contains('gm-style-mot') ||
            node.textContent?.includes("can't load Google Maps")) {
          node.style.display = 'none';
          node.remove();
        }
        // Also check children
        node.querySelectorAll?.('div[role="dialog"], .gm-err-container, .gm-style-mot')?.forEach(el => {
          (el as HTMLElement).style.display = 'none';
          el.remove();
        });
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// 3. Periodic cleanup as fallback
setInterval(() => {
  document.querySelectorAll('div[role="dialog"]').forEach(el => {
    if (el.textContent?.includes("can't load Google Maps") || el.textContent?.includes("Do you own this website")) {
      (el as HTMLElement).style.display = 'none';
      el.remove();
    }
  });
  document.querySelectorAll('.gm-err-container, .gm-style-mot, .gm-err-autocomplete').forEach(el => el.remove());
}, 500);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
