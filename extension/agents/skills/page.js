import {
    summarizePage,
    generateNotes,
    explainPage,
    translatePage
} from "../../services/aiService.js";

import { getCurrentPageData } from "../../services/pageService.js";

import { COMMANDS } from "../../types/commands.js";

const PAGE_ACTIONS = {

    [COMMANDS.SUMMARIZE_PAGE]: summarizePage,

    [COMMANDS.GENERATE_NOTES]: generateNotes,

    [COMMANDS.EXPLAIN_PAGE]: explainPage,

    [COMMANDS.TRANSLATE_PAGE]: translatePage

};

export async function pageSkill(command) {

    const action = PAGE_ACTIONS[command.intent];

    if (!action) {
        return null;
    }

    const pageData = await getCurrentPageData();

    const result = await action(pageData);

    return result;

}