const api = typeof browser !== "undefined" ? browser : chrome;

const defaultSettings = {
    enableFolders: false,
    showSnippets: true,
    enableNotifications: true,
    showBadge: true,
    refreshInterval: 5
};

// Map settings to their inputs
const inputs = {
    enableFolders: "enableFolders",
    showSnippets: "showSnippets",
    enableNotifications: "enableNotifications",
    showBadge: "showBadge",
    refreshInterval: "refreshInterval"
};

// Initialize theme
function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "default";
    document.body.setAttribute("data-theme", savedTheme);
}

// Load settings
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();

    // 1. Get current settings
    const result = await api.storage.local.get(["settings", "accountEmail"]);
    const settings = result.settings || defaultSettings;
    const email = result.accountEmail || "Not Connected";

    // 2. Set account email
    const emailEl = document.getElementById("userEmail");
    if (emailEl) {
        emailEl.textContent = email;
    }

    // 3. Populate inputs
    for (const [key, id] of Object.entries(inputs)) {
        const el = document.getElementById(id);
        if (!el) {
            console.error(`Element not found: ${id}`);
            continue;
        }

        if (el.type === "checkbox") {
            el.checked = (settings[key] !== undefined) ? settings[key] : defaultSettings[key];
        } else {
            el.value = settings[key] || defaultSettings[key];
        }

        // Add listeners
        el.addEventListener("change", saveSettings);
    }

    // 4. Back button listener
    document.getElementById("backBtn").addEventListener("click", () => {
        window.location.href = "popup.html";
    });
});

// Save settings automatically
async function saveSettings() {
    const newSettings = {};

    for (const [key, id] of Object.entries(inputs)) {
        const el = document.getElementById(id);
        if (!el) continue;

        if (el.type === "checkbox") {
            newSettings[key] = el.checked;
        } else {
            newSettings[key] = parseInt(el.value, 10);
        }
    }

    // Update storage
    await api.storage.local.set({ settings: newSettings });

    // Notify background to update alarm if interval changed
    if (newSettings.refreshInterval) {
        api.runtime.sendMessage({
            action: "updateInterval",
            interval: newSettings.refreshInterval
        });
    }

    // Refresh badge immediately if toggled
    if (newSettings.showBadge === false) {
        if (api.action || api.browserAction) {
            const action = api.action || api.browserAction;
            action.setBadgeText({ text: "" });
        }
    } else {
        // Trigger a refresh to show badge again
        api.runtime.sendMessage({ action: "refresh" });
    }
}
