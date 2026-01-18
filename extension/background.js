const api = typeof browser !== "undefined" ? browser : chrome;

const BACKEND_URL = "https://zoho-mail-backend-d4uw.onrender.com";
const ALARM_NAME = "poll-unread";
const NOTIFICATION_ID = "new-mail-notify";

// Poll mutex
let pollInProgress = false;

// Badge state tracking (never read from browser)
let badgeState = {
    text: "",
    color: ""
};

// Initial setup - Generate session_id once and force first fetch
api.runtime.onInstalled.addListener(async () => {
    console.log("Zoho Extension: Initialized. Waiting for auth.");

    // Generate session_id once per browser install (multi-session support)
    const { session_id } = await api.storage.local.get('session_id');
    if (!session_id) {
        const sessionId = crypto.randomUUID();
        await api.storage.local.set({ session_id: sessionId });
        console.log('Session ID generated:', sessionId);
    } else {
        console.log('Existing session ID:', session_id);
    }

    checkMail(true); // Edge fix: force first fetch
});

// Alarm listener
api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        checkMail();
    }
});

// Listen for JWT storage to trigger immediate poll after OAuth
api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.jwt && changes.jwt.newValue) {
        console.log("JWT stored, triggering initial poll");
        checkMail(true);
    }
});

// Alarm persistence and startup fetch for Edge
api.runtime.onStartup.addListener(async () => {
    checkMail(true); // Edge fix: force fetch on startup
    const data = await api.storage.local.get("authError");
    if (data.authError === false) {
        const settings = (await api.storage.local.get("settings")).settings || { refreshInterval: 5 };
        api.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshInterval || 5 });
    }
})

// Handle icon click (Manual Refresh)
if (api.action) {
    api.action.onClicked.addListener(() => {
        checkMail(true);
    });
}

async function checkMail(force = false, retryCount = 0) {
    if (pollInProgress) {
        console.log("Poll already in progress, skipping.");
        return;
    }

    pollInProgress = true;

    try {
        const data = await api.storage.local.get(["jwt", "lastUnread", "lastNotificationTime"]);
        if (!data.jwt) {
            updateBadge(""); // New user: show nothing on icon
            return;
        }

        const url = `${BACKEND_URL}/mail/unread${force ? "?refresh=true" : ""}`;

        // Show loading if online (doesn't overwrite badgeState)
        if (navigator.onLine) {
            updateBadge("⏳", "#6B7280");
        }

        const res = await fetch(url, {
            headers: { "Authorization": `Bearer ${data.jwt}` }
        });

        if (res.status === 401 || res.status === 403) {
            const errData = await res.json();
            if (errData.error === "re_auth_required") {
                // Retry once before validating the failure (handles backend cold starts/hiccups)
                if (retryCount < 1) {
                    console.log("Auth error detected, retrying once...");
                    pollInProgress = false; // Unlock to allow retry recursion
                    await new Promise(r => setTimeout(r, 2000));
                    return checkMail(force, retryCount + 1);
                }

                // CRITICAL FIX: Do NOT mark authError if this is the very first setup attempt
                // "New User" means lastUnread is undefined.
                const isFirstSetup = data.lastUnread === undefined;

                if (!isFirstSetup) {
                    updateBadge("!", "#EF4444");
                    api.storage.local.set({ authError: true });
                } else {
                    console.log("Ignoring auth error during initial setup (transient)");
                }
                return;
            }
        }

        if (!res.ok) {
            // Non-auth error (500, 503, etc.) - restore previous badge, don't show "?"
            console.error("Backend error:", res.status);
            updateBadge(badgeState.text, badgeState.color);
            return;
        }

        const responseData = await res.json();
        const unread = responseData.unread;

        if (unread === undefined) {
            throw new Error("Invalid response format: missing unread count");
        }

        const settings = (await api.storage.local.get("settings")).settings || {};

        // Badge logic
        if (settings.showBadge !== false) {
            handleBadgeUpdate(unread);
        } else {
            updateBadge("");
        }

        // Notification logic
        if (settings.enableNotifications !== false) {
            handleNotification(unread, data.lastUnread, data.lastNotificationTime);
        }

        // Save state and clear error
        await api.storage.local.set({
            lastUnread: unread,
            authError: false
        });

        // Ensure alarm is running (Start it now that we have success)
        const alarm = await api.alarms.get(ALARM_NAME);
        if (!alarm) {
            api.alarms.create(ALARM_NAME, { periodInMinutes: settings.refreshInterval || 5 });
        }

    } catch (err) {
        console.error("Poll failed:", err);
        // Restore previous badge on error (don't show "?")
        updateBadge(badgeState.text, badgeState.color);
    } finally {
        pollInProgress = false;
    }
}

// Wrapper to handle badge safely across browsers (Chrome MV3 vs Firefox MV2)
function updateBadge(text, color) {
    const action = api.action || api.browserAction;
    if (!action) return;

    // Firefox MV2 requires strings, Chrome MV3 allows integers but strings are safer
    const textStr = text ? text.toString() : "";

    action.setBadgeText({ text: textStr });

    if (color && action.setBadgeBackgroundColor) {
        action.setBadgeBackgroundColor({ color });
    }

    // Save to badgeState (except for loading indicator)
    if (text !== "⏳") {
        badgeState = { text: textStr, color: color || "" };
    }
}

function handleBadgeUpdate(current) {
    let text = current.toString();
    if (current > 99) text = "99+";
    if (current === 0) text = "";

    updateBadge(text, "#1178D2"); // Zoho Blue
}

function handleNotification(current, previous, lastNotifyTime) {
    // Do not notify on first-ever fetch
    if (previous === undefined) return;

    // Notify only if unread count increased
    if (current <= previous) return;

    // Rate limit notifications (max 1 per 5 mins)
    const now = Date.now();
    if (lastNotifyTime && (now - lastNotifyTime < 5 * 60 * 1000)) return;

    api.notifications.create(NOTIFICATION_ID, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "New Zoho Mail",
        message: `You have ${current} unread messages.`,
        priority: 2
    });

    api.storage.local.set({ lastNotificationTime: now });
}

// Listen for messages from popup (e.g., "manual refresh" or "set token")
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "refresh") {
        checkMail(true).then(() => {
            sendResponse({ status: "refreshed" });
        });
        return true; // Keep channel open for async response
    }

    if (msg.action === "auth_success") {
        console.log("Auth success received, restarting polling...");
        // Ensure alarm exists after auth
        api.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
        // Immediately check mail with force refresh to rehydrate state
        checkMail(true);
        sendResponse({ status: "polling_restarted" });
    }

    if (msg.action === "updateInterval") {
        console.log("Updating alarm interval to:", msg.interval);
        api.alarms.create(ALARM_NAME, { periodInMinutes: msg.interval });
    }

    if (msg.type === "ZOHO_AUTH_TOKEN" && msg.token) {
        // Optional: Validate sender origin (extra security layer)
        if (sender.url && !sender.url.startsWith(BACKEND_URL)) {
            console.warn("Token rejected: invalid sender origin", sender.url);
            sendResponse({ success: false, error: "invalid_origin" });
            return true;
        }

        api.storage.local.set({
            jwt: msg.token,
            authError: false
        }, () => {
            checkMail(true);
        });
        sendResponse({ success: true });
    }

    return true;
});
