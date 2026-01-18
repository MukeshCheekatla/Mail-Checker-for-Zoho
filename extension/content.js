const api = typeof browser !== "undefined" ? browser : chrome;

// Listen for messages from the web page (Universal Bridge)
window.addEventListener("message", (event) => {
    // Security check: only accept messages from the window itself
    if (event.source !== window) return;

    if (event.data && event.data.type === "ZOHO_AUTH_TOKEN" && event.data.token) {
        console.log("Content script received token, forwarding to background...");
        api.runtime.sendMessage(event.data, (response) => {
            console.log("Background response:", response);
        });
    }
});
