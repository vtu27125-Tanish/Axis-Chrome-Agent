import { parseIntent } from "./intentParser.js";
import { createExecutionPlan } from "./planner.js";

export function routeMessage(userMessage) {

    // Try local/browser intent first
    const command = parseIntent(userMessage);

    let type = "ai";

    if (command.intent && command.intent !== "unknown") {
        type = "browser";
    }

    // Ask the planner what resources are needed
    const plan = createExecutionPlan(command);

    return {

        type,

        userMessage,

        command,

        plan

    };

}