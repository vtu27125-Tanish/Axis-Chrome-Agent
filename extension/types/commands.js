// types/commands.js

export const COMMANDS = {

    // ======================================
    // Browser Navigation
    // ======================================

    OPEN_WEBSITE: "open_website",
    GOOGLE_SEARCH: "google_search",
    CLOSE_TAB: "close_tab",
    RELOAD_TAB: "reload_tab",
    GO_BACK: "go_back",
    GO_FORWARD: "go_forward",
    DUPLICATE_TAB: "duplicate_tab",
    PIN_TAB: "pin_tab",
    UNPIN_TAB: "unpin_tab",
    CREATE_TAB: "create_tab",
    SWITCH_TAB: "switch_tab",
    LIST_TABS: "list_tabs",

// ======================================
// Bookmarks
// ======================================

BOOKMARK_PAGE: "bookmark_page",

OPEN_BOOKMARKS: "open_bookmarks",

LIST_BOOKMARKS: "list_bookmarks",

DELETE_BOOKMARK: "delete_bookmark",

OPEN_HISTORY: "open_history",

OPEN_DOWNLOADS: "open_downloads",

    // ======================================
    // Page Understanding
    // ======================================

    SUMMARIZE_PAGE: "summarize_page",
    EXPLAIN_PAGE: "explain_page",
    TRANSLATE_PAGE: "translate_page",
    GENERATE_NOTES: "generate_notes",
    EXTRACT_KEY_POINTS: "extract_key_points",
    EXTRACT_LINKS: "extract_links",
    EXTRACT_EMAILS: "extract_emails",
    EXTRACT_TABLES: "extract_tables",

    // ======================================
    // Browser Automation
    // ======================================

    CLICK_ELEMENT: "click_element",
    TYPE_TEXT: "type_text",
    SCROLL_PAGE: "scroll_page",
    FILL_FORM: "fill_form",
    SELECT_OPTION: "select_option",
    TAKE_SCREENSHOT: "take_screenshot",

    // ======================================
    // Memory
    // ======================================

    REMEMBER: "remember",
    RECALL_MEMORY: "recall_memory",
    FORGET_MEMORY: "forget_memory",

    // ======================================
    // Conversation
    // ======================================

    CHAT: "chat",
    ASK_AI: "ask_ai",

    // ======================================
    // Research
    // ======================================

    RESEARCH: "research",
    SEARCH_WEB: "search_web",
    COMPARE_INFORMATION: "compare_information",

    // ======================================
    // Files
    // ======================================

    READ_FILE: "read_file",
    SUMMARIZE_FILE: "summarize_file",
    ANALYZE_FILE: "analyze_file",

    // ======================================
    // Reminders
    // ======================================

    CREATE_REMINDER: "create_reminder",
    LIST_REMINDERS: "list_reminders",
    DELETE_REMINDER: "delete_reminder",

    // ======================================
    // System
    // ======================================

    COPY_URL: "copy_url",
    GET_CONTEXT: "get_context",

    // ======================================
    // Unknown
    // ======================================

    UNKNOWN: "unknown"

};