// agents/browserAgent.js

import { navigationSkill } from "./skills/navigation.js";
import { tabSkill } from "./skills/tabs.js";
import { bookmarkSkill } from "./skills/bookmarks.js";
import { pageSkill } from "./skills/page.js";

export async function executeBrowserCommand(command) {

    const skills = [

        navigationSkill,

        tabSkill,

        bookmarkSkill,

        pageSkill

    ];

    for (const skill of skills) {

        try {

            const result = await skill(command);

            if (result !== null && result !== undefined) {

                return result;

            }

        }

        catch (error) {

            console.error(
                `[Axis] ${skill.name} failed`,
                error
            );

        }

    }

    return {

        success: false,

        message: `No browser skill found for "${command.intent}".`

    };

}