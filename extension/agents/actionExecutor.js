// agents/actionExecutor.js

import { executeBrowserCommand } from "./browserAgent.js";
import { executeTools } from "../engine/toolExecutor.js";

export async function executePlan(plan, userMessage) {

    try {

        // =====================================
        // Browser Commands
        // =====================================

        if (plan.tools.includes("browser")) {

            return await executeBrowserCommand(
                plan.originalCommand
            );

        }

        // =====================================
        // Everything else
        // =====================================

        return await executeTools(
            plan,
            userMessage
        );

    }

    catch (error) {

        console.error("[ActionExecutor]", error);

        return {

            success: false,

            message: error.message

        };

    }

}