const CACHE = 'aiva-shell-v4';
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
// Deliberately no fetch handler: /api/* requests always go directly to the server.
