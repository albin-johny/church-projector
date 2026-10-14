/* Registers the service worker (see sw.js) so the app is installable and starts offline. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker not registered:', e));
  });
}
