// ======================================
// Page Service
// Collect current webpage information
// ======================================

export async function getCurrentPageData() {

    try {

        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        if (!tab) {
            throw new Error("No active tab found.");
        }

        const injection = await chrome.scripting.executeScript({
            target: {
                tabId: tab.id
            },
            func: () => {
                return {
                    title: document.title,
                    url: window.location.href,
                    page_content: document.body.innerText || ""
                };
            }
        });

        return injection[0].result;

    } catch (error) {

        console.error("[Page Service]", error);

        return {
            title: "",
            url: "",
            page_content: ""
        };

    }

}