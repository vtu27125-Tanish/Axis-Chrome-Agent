import {
    reloadCurrentTab,
    goBack,
    goForward
} from "../../services/browserService.js";

import { COMMANDS } from "../../types/commands.js";

const NAVIGATION_ACTIONS = {

    [COMMANDS.RELOAD_TAB]: () =>
        reloadCurrentTab(),

    [COMMANDS.GO_BACK]: () =>
        goBack(),

    [COMMANDS.GO_FORWARD]: () =>
        goForward()

};

export async function navigationSkill(command) {

    const action = NAVIGATION_ACTIONS[command.intent];

    if (!action) {
        return null;
    }

    return await action();

}