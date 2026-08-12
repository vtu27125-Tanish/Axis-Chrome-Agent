export async function detectCurrentSite() {

    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    if (!tab) {

        return {

            title: "",

            url: "",

            protocol: "",

            hostname: "",

            origin: "",

            pageType: "unknown"

        };

    }

    let hostname = "";

    let protocol = "";

    let origin = "";

    try {

        const parsed = new URL(tab.url);

        hostname = parsed.hostname;

        protocol = parsed.protocol;

        origin = parsed.origin;

    } catch (e) {}

    return {

        title: tab.title || "",

        url: tab.url || "",

        hostname,

        protocol,

        origin,

        pageType: protocol === "chrome:"
            ? "browser"
            : "web"

    };

}