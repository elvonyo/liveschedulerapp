self.addEventListener("push", function(event) {
  var data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "LiveSupport Scheduler", {
      body:  data.body  || "Someone just went live!",
      icon:  "/icon-192.png",
      badge: "/badge-72.png",
      data:  { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then(function(windowClients) {
      var url = event.notification.data ? event.notification.data.url : "/";
      for (var i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url === url && "focus" in windowClients[i]) {
          return windowClients[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
// updated Thu Apr 30 19:04:48 EDT 2026
// reconnected Thu Apr 30 19:10:12 EDT 2026
// reconnected Thu Apr 30 19:16:08 EDT 2026
// force Thu Apr 30 19:30:05 EDT 2026
