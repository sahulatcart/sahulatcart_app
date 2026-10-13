/* Service worker for merchant alerts (P3). It does two things only: show a push payload as a
   notification, and open the page it points at when tapped. No caching, no offline. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Sahulatcart', body: event.data ? event.data.text() : '' }; }
  var title = data.title || 'Sahulatcart';
  var url = data.url || '/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png', // monochrome: Android draws it as a white silhouette
    data: { url: url },
    // One entry per notification (its row id), so a second "Bot needs help" does not replace the first.
    tag: data.id || (url + ':' + Date.now()),
    renotify: true,
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
        // navigate() can reject on an uncontrolled window; fall back to a new one.
        return list[i].focus().then(function (c) { return c.navigate(url); }).catch(function () { return self.clients.openWindow(url); });
      }
    }
    return self.clients.openWindow(url);
  }));
});
