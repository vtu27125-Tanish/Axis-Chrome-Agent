// agents/planner.js

import { COMMANDS } from "../types/commands.js";

export function createExecutionPlan(command) {

    const plan = {

        originalCommand: command,

        tools: [],

        requiresAI: false,

        requiresContext: false,

        requiresMemory: false,

        requiresResearch: false

    };

    switch (command.intent) {

        // ======================================
        // Browser
        // ======================================

        case COMMANDS.OPEN_WEBSITE:
        case COMMANDS.GOOGLE_SEARCH:
        case COMMANDS.CLOSE_TAB:
        case COMMANDS.RELOAD_TAB:
        case COMMANDS.GO_BACK:
        case COMMANDS.GO_FORWARD:
        case COMMANDS.DUPLICATE_TAB:
        case COMMANDS.PIN_TAB:
        case COMMANDS.UNPIN_TAB:
        case COMMANDS.CREATE_TAB:
        case COMMANDS.SWITCH_TAB:
        case COMMANDS.LIST_TABS:

            plan.tools.push("browser");
            return plan;

        // ======================================
        // Bookmarks
        // ======================================

        case COMMANDS.BOOKMARK_PAGE:
        case COMMANDS.OPEN_BOOKMARKS:
        case COMMANDS.OPEN_HISTORY:
        case COMMANDS.OPEN_DOWNLOADS:
        case COMMANDS.LIST_BOOKMARKS:
        case COMMANDS.DELETE_BOOKMARK:

            plan.tools.push("bookmark");
            return plan;

        // ======================================
        // Page Understanding
        // ======================================

        case COMMANDS.SUMMARIZE_PAGE:
        case COMMANDS.TRANSLATE_PAGE:
        case COMMANDS.EXPLAIN_PAGE:
        case COMMANDS.GENERATE_NOTES:
        case COMMANDS.EXTRACT_KEY_POINTS:
        case COMMANDS.EXTRACT_LINKS:
        case COMMANDS.EXTRACT_EMAILS:
        case COMMANDS.EXTRACT_TABLES:

            plan.tools.push("page");

            plan.requiresAI = true;
            plan.requiresContext = true;

            return plan;

        // ======================================
        // Memory
        // ======================================

        case COMMANDS.REMEMBER:
        case COMMANDS.RECALL_MEMORY:
        case COMMANDS.FORGET_MEMORY:

            plan.tools.push("memory");

            plan.requiresMemory = true;

            return plan;

        // ======================================
        // Reminder
        // ======================================

        case COMMANDS.CREATE_REMINDER:
        case COMMANDS.LIST_REMINDERS:
        case COMMANDS.DELETE_REMINDER:

            plan.tools.push("reminder");

            return plan;

        // ======================================
        // Research
        // ======================================

        case COMMANDS.RESEARCH:
        case COMMANDS.SEARCH_WEB:
        case COMMANDS.COMPARE_INFORMATION:

            plan.tools.push("research");

            plan.requiresAI = true;
            plan.requiresResearch = true;

            return plan;

        // ======================================
        // Browser Automation
        // ======================================

        case COMMANDS.CLICK_ELEMENT:
        case COMMANDS.TYPE_TEXT:
        case COMMANDS.SCROLL_PAGE:
        case COMMANDS.FILL_FORM:
        case COMMANDS.SELECT_OPTION:
        case COMMANDS.TAKE_SCREENSHOT:

            plan.tools.push("automation");

            return plan;

        // ======================================
        // File Analysis
        // ======================================

        case COMMANDS.READ_FILE:
        case COMMANDS.SUMMARIZE_FILE:
        case COMMANDS.ANALYZE_FILE:

            plan.tools.push("file");

            plan.requiresAI = true;

            return plan;

        // ======================================
        // Default
        // ======================================

        default:

            plan.requiresAI = true;

            return plan;

    }

}