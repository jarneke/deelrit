self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

function notificationUrl(value) {
    try {
        const url = new URL(
            typeof value === "string" ? value : "/account",
            self.location.origin,
        );

        if (
            url.origin === self.location.origin &&
            (
                url.pathname === "/account" ||
                url.pathname.startsWith("/auto/")
            )
        ) {
            return url.href;
        }
    } catch {
        return new URL("/account", self.location.origin).href;
    }

    return new URL("/account", self.location.origin).href;
}

self.addEventListener("push", (event) => {
    let message = {};

    try {
        const parsed = event.data ? event.data.json() : {};

        if (parsed && typeof parsed === "object") {
            message = parsed;
        }
    } catch {
        message = {};
    }

    event.waitUntil(
        self.registration.showNotification(
            typeof message.title === "string" ? message.title : "Deelrit",
            {
                body:
                    typeof message.body === "string"
                        ? message.body
                        : "Je hebt een nieuwe melding.",
                icon: "/apple-icon.png",
                tag:
                    typeof message.tag === "string"
                        ? message.tag
                        : "deelrit",
                data: {
                    url: notificationUrl(message.url),
                },
            },
        ),
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const target = notificationUrl(event.notification.data?.url);

    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });

            const existing = windows.find(
                (client) =>
                    new URL(client.url).origin === self.location.origin,
            );

            if (existing) {
                try {
                    const navigated = await existing.navigate(target);

                    if (navigated) {
                        await navigated.focus();
                        return;
                    }
                } catch {
                    await self.clients.openWindow(target);
                    return;
                }
            }

            await self.clients.openWindow(target);
        })(),
    );
});