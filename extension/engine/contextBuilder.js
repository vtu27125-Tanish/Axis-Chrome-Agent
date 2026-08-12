export async function buildContext() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab) {
        return null;
    }

    const context = {
        title: tab.title || "",
        url: tab.url || "",
        pageContent: "",
        selectedText: "",
        html: "",
        metadata: {},
        timestamp: new Date().toISOString()
    };

    try {

        const response = await chrome.tabs.sendMessage(tab.id, {
            type: "get_page_context"
        });

        if (response?.success) {

            context.title = response.context.title;
            context.url = response.context.url;
            context.pageContent = response.context.pageText;
            context.selectedText = response.context.selectedText;
            context.html = response.context.html;
            context.metadata = response.context.metadata;

        }

    } catch (error) {

        console.warn("[Axis] Content script unavailable.", error);

    }

    // Browser Information
    context.browser = {

        tabId: tab.id,
        windowId: tab.windowId,
        favIcon: tab.favIconUrl || "",
        audible: tab.audible || false,
        pinned: tab.pinned || false,
        incognito: tab.incognito || false

    };

    return context;

}