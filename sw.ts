self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "LiveSupport Scheduler", {
      body:  data.body ?? "Someone just went live!",
      icon:  "/icon-192.png",
      badge: "/badge-72.png",
      data:  { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      const url = event.notification.data?.url ?? "/";
      for (const client of windowClients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});