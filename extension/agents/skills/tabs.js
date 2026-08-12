import {
    openWebsite,
    googleSearch,
    closeCurrentTab,
    duplicateCurrentTab,
    pinCurrentTab,
    unpinCurrentTab,
    createNewTab,
    listTabs,
    switchTab
} from "../../services/browserService.js";

import { COMMANDS } from "../../types/commands.js";

const TAB_ACTIONS = {

    // ============================
    // Navigation
    // ============================

    [COMMANDS.OPEN_WEBSITE]: (command) =>
        openWebsite(command.url),

    [COMMANDS.GOOGLE_SEARCH]: (command) =>
        googleSearch(command.query),

    // ============================
    // Tab Management
    // ============================

    [COMMANDS.CLOSE_TAB]: () =>
        closeCurrentTab(),

    [COMMANDS.DUPLICATE_TAB]: () =>
        duplicateCurrentTab(),

    [COMMANDS.PIN_TAB]: () =>
        pinCurrentTab(),

    [COMMANDS.UNPIN_TAB]: () =>
        unpinCurrentTab(),

    [COMMANDS.CREATE_TAB]: () =>
        createNewTab(),

    [COMMANDS.LIST_TABS]: () =>
        listTabs(),

    [COMMANDS.SWITCH_TAB]: (command) =>
        switchTab(command.tabId)

};

export async function tabSkill(command) {

    const action = TAB_ACTIONS[command.intent];

    if (!action) {
        return null;
    }

    return await action(command);

}