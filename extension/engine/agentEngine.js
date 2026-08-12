// engine/agentEngine.js

import { execute } from "./executionEngine.js";

export async function processCommand(userInput) {

    try {

        console.log("[Axis] Processing:", userInput);

        return await execute(userInput);

    } catch (error) {

        console.error("[Axis Agent]", error);

        return {

            success: false,

            message: "Axis was unable to process your request."

        };

    }

}