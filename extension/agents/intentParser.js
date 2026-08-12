import { COMMANDS } from "../types/commands.js";

export function parseIntent(message) {

    const text = message.toLowerCase().trim();

    // ============================
    // Open Websites
    // ============================

    if (text.startsWith("open ")) {

        const site = text.replace("open", "").trim();

        const websites = {
            github: "https://github.com",
            google: "https://google.com",
            youtube: "https://youtube.com",
            linkedin: "https://linkedin.com",
            chatgpt: "https://chatgpt.com",
            gmail: "https://mail.google.com"
        };

        if (websites[site]) {

            return {
                intent: COMMANDS.OPEN_WEBSITE,
                url: websites[site]
            };

        }

    }

    // ============================
    // Google Search
    // ============================

    if (text.startsWith("search ")) {

        return {
            intent: COMMANDS.GOOGLE_SEARCH,
            query: text.replace("search", "").trim()
        };

    }

    // ============================
    // Navigation
    // ============================

    if (text === "reload" || text === "reload page") {
        return { intent: COMMANDS.RELOAD_TAB };
    }

    if (text === "go back") {
        return { intent: COMMANDS.GO_BACK };
    }

    if (text === "go forward") {
        return { intent: COMMANDS.GO_FORWARD };
    }

    // ============================
    // Tabs
    // ============================

    if (text === "close tab") {
        return { intent: COMMANDS.CLOSE_TAB };
    }

    if (text === "duplicate tab") {
        return { intent: COMMANDS.DUPLICATE_TAB };
    }

    if (text === "pin tab") {
        return { intent: COMMANDS.PIN_TAB };
    }

    if (text === "unpin tab") {
        return { intent: COMMANDS.UNPIN_TAB };
    }

    if (text === "new tab") {
        return { intent: COMMANDS.CREATE_TAB };
    }

    if (text === "list tabs") {
        return { intent: COMMANDS.LIST_TABS };
    }

    // ============================
    // Bookmarks
    // ============================

    if (text === "bookmark this" || text === "bookmark page") {
        return { intent: COMMANDS.BOOKMARK_PAGE };
    }

    if (text === "open bookmarks") {
        return { intent: COMMANDS.OPEN_BOOKMARKS };
    }

    if (text === "open history") {
        return { intent: COMMANDS.OPEN_HISTORY };
    }

    if (text === "open downloads") {
        return { intent: COMMANDS.OPEN_DOWNLOADS };
    }

    // ============================
    // Page AI
    // ============================

    if (text.startsWith("summarize")) {
        return { intent: COMMANDS.SUMMARIZE_PAGE };
    }

    if (text.startsWith("translate")) {
        return { intent: COMMANDS.TRANSLATE_PAGE };
    }

    if (text.startsWith("explain")) {
        return { intent: COMMANDS.EXPLAIN_PAGE };
    }

    // ============================
    // Research
    // ============================

    if (text.startsWith("research ")) {

        return {
            intent: COMMANDS.RESEARCH,
            query: text.replace("research", "").trim()
        };

    }
    // ============================
    // Memory
    // ============================

    if (text.startsWith("remember ")) {

        return {
            intent: COMMANDS.REMEMBER,
            data: text.replace("remember", "").trim()
        };

    }

    // ============================
    // Page AI
    // ============================

    if (text.includes("summarize")) {

        return {
            intent: COMMANDS.SUMMARIZE_PAGE
        };

    }

    if (text.includes("generate notes")) {

        return {
            intent: COMMANDS.GENERATE_NOTES
        };

    }

    if (text.includes("explain page")) {

        return {
            intent: COMMANDS.EXPLAIN_PAGE
        };

    }

    if (text.includes("translate page")) {

        return {
            intent: COMMANDS.TRANSLATE_PAGE
        };

    }

    // ============================
    // Unknown
    // ============================

    return {
        intent: COMMANDS.UNKNOWN
    };

}