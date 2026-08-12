export async function openWebsite(url) {
    await chrome.tabs.create({
        url
    });

    return {
        success: true,
        message: `Opened ${url}`
    };
}

export async function googleSearch(query) {

    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    await chrome.tabs.create({
        url
    });

    return {
        success: true,
        message: `Searching for "${query}"`
    };
}

export async function closeCurrentTab() {

    const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (tabs.length > 0) {
        await chrome.tabs.remove(tabs[0].id);
    }

    return {
        success: true,
        message: "Current tab closed."
    };
}
export async function reloadCurrentTab() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab) {
        return {
            success: false,
            message: "No active tab."
        };
    }

    await chrome.tabs.reload(tab.id);

    return {
        success: true,
        message: "Page reloaded."
    };
}

export async function goBack() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    await chrome.scripting.executeScript({
        target: {
            tabId: tab.id
        },
        func: () => history.back()
    });

    return {
        success: true,
        message: "Going back."
    };
}

export async function goForward() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    await chrome.scripting.executeScript({
        target: {
            tabId: tab.id
        },
        func: () => history.forward()
    });

    return {
        success: true,
        message: "Going forward."
    };
}

export async function duplicateCurrentTab() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    await chrome.tabs.duplicate(tab.id);

    return {
        success: true,
        message: "Tab duplicated."
    };
}

export async function pinCurrentTab() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    await chrome.tabs.update(tab.id, {
        pinned: true
    });

    return {
        success: true,
        message: "Tab pinned."
    };
}

export async function unpinCurrentTab() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    await chrome.tabs.update(tab.id, {
        pinned: false
    });

    return {
        success: true,
        message: "Tab unpinned."
    };
}
export async function createNewTab() {

    const tab = await chrome.tabs.create({});

    return {
        success: true,
        message: "New tab created.",
        tabId: tab.id
    };

}
export async function listTabs() {

    const tabs = await chrome.tabs.query({
        currentWindow: true
    });

    return {
        success: true,
        tabs: tabs.map(tab => ({
            id: tab.id,
            title: tab.title,
            url: tab.url,
            active: tab.active,
            pinned: tab.pinned
        }))
    };

}
export async function switchTab(tabId) {

    await chrome.tabs.update(tabId, {
        active: true
    });

    return {
        success: true,
        message: "Switched tab."
    };

}
export async function getCurrentTab() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return {
        success: true,
        tab
    };

}
export async function captureScreenshot() {

    const image = await chrome.tabs.captureVisibleTab();

    return {
        success: true,
        image
    };

}
// =====================================
// Bookmark Current Page
// =====================================

export async function bookmarkCurrentPage() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab) {
        return {
            success: false,
            message: "No active tab."
        };
    }

    await chrome.bookmarks.create({
        title: tab.title,
        url: tab.url
    });

    return {
        success: true,
        message: "Current page bookmarked."
    };

}

// =====================================
// Open Chrome Bookmarks
// =====================================

export async function openBookmarks() {

    await chrome.tabs.create({
        url: "chrome://bookmarks/"
    });

    return {
        success: true,
        message: "Bookmarks opened."
    };

}

// =====================================
// Open Chrome History
// =====================================

export async function openHistory() {

    await chrome.tabs.create({
        url: "chrome://history/"
    });

    return {
        success: true,
        message: "History opened."
    };

}

// =====================================
// Open Chrome Downloads
// =====================================

export async function openDownloads() {

    await chrome.tabs.create({
        url: "chrome://downloads/"
    });

    return {
        success: true,
        message: "Downloads opened."
    };

}