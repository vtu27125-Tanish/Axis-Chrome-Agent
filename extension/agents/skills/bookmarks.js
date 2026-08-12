import {
    bookmarkCurrentPage,
    openBookmarks,
    openHistory,
    openDownloads
} from "../../services/browserService.js";

import { COMMANDS } from "../../types/commands.js";

const BOOKMARK_ACTIONS = {

    // ======================================
    // Bookmark Current Page
    // ======================================

    [COMMANDS.BOOKMARK_PAGE]: () =>
        bookmarkCurrentPage(),

    // ======================================
    // Open Bookmark Manager
    // ======================================

    [COMMANDS.OPEN_BOOKMARKS]: () =>
        openBookmarks(),

    // ======================================
    // Open Browser History
    // ======================================

    [COMMANDS.OPEN_HISTORY]: () =>
        openHistory(),

    // ======================================
    // Open Downloads
    // ======================================

    [COMMANDS.OPEN_DOWNLOADS]: () =>
        openDownloads()

};

export async function bookmarkSkill(command) {

    const action = BOOKMARK_ACTIONS[command.intent];

    if (!action) {
        return null;
    }

    try {

        return await action();

    } catch (error) {

        console.error("[BookmarkSkill]", error);

        return {
            success: false,
            message: error.message
        };

    }

}