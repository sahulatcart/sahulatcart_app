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
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    data: { url: url },
    tag: url, // a second alert for the same page replaces the first instead of stacking
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.location.origin) === 0 && 'focus' in list[i]) {
        list[i].navigate(url);
        return list[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
