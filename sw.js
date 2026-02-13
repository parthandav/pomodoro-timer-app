// Service Worker for Pomodoro Timer
// Purpose: Schedule OS-level notifications at exact timer completion time,
// even when the browser tab is in the background or the main thread is throttled.

let scheduledTimer = null;

self.addEventListener('install', (event) => {
    // Activate immediately without waiting for existing tabs to close
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Take control of all open clients immediately
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data.type === 'schedule-completion') {
        // Cancel any previously scheduled completion
        if (scheduledTimer !== null) {
            clearTimeout(scheduledTimer);
            scheduledTimer = null;
        }

        const endTime = event.data.endTime;
        const taskName = event.data.taskName || '';
        const delay = Math.max(0, endTime - Date.now());

        // event.waitUntil keeps the Service Worker alive until the promise settles.
        // Without this, the browser may kill the SW before the timeout fires.
        event.waitUntil(
            new Promise((resolve) => {
                scheduledTimer = setTimeout(() => {
                    scheduledTimer = null;

                    const notificationBody = taskName
                        ? `"${taskName}" is done! Great focus session.`
                        : 'Your focus session is complete. Time for a break!';

                    self.registration.showNotification('Pomodoro Complete!', {
                        body: notificationBody,
                        icon: '/icon-192.png',
                        badge: '/icon-192.png',
                        tag: 'pomodoro-complete',
                        requireInteraction: true,
                        vibrate: [200, 100, 200],
                        actions: [
                            { action: 'open', title: 'Open App' }
                        ]
                    });

                    // Also notify all open clients so the tab can update its state
                    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
                        .then((clients) => {
                            clients.forEach((client) => {
                                client.postMessage({ type: 'timer-complete' });
                            });
                        });

                    resolve();
                }, delay + 200); // +200ms buffer to avoid racing the Web Worker
            })
        );

    } else if (event.data.type === 'cancel-completion') {
        if (scheduledTimer !== null) {
            clearTimeout(scheduledTimer);
            scheduledTimer = null;
        }
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                // Focus an existing tab if one is open
                for (const client of clients) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Otherwise open a new tab
                if (self.clients.openWindow) {
                    return self.clients.openWindow('/');
                }
            })
    );
});
