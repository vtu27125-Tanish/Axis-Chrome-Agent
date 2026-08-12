import { routeMessage } from "./messageRouter.js";
import { executeBrowserCommand } from "./browserAgent.js";
import { buildContext } from "../engine/contextBuilder.js";
import { buildPrompt } from "./promptBuilder.js";
import { askGemini } from "../services/aiService.js";
import { pageSkill } from "./skills/page.js";

export async function handleAgentRequest(userMessage) {

    try {

        // Step 1: Route the message
        const route = routeMessage(userMessage);

        console.log("Route:", route);

        // Step 2: Browser command
        if (route.type === "browser") {

            return await executeBrowserCommand(route.command);

        }

        // Step 3: Build context
        const context = await buildContext();

        console.log("Context:", context);

        // Step 4: Build AI prompt
        const prompt = buildPrompt(userMessage, context);

        console.log("Prompt Ready");

        // Step 5: Ask Gemini
        const response = await askGemini(prompt);

        return {

            success: true,

            message: response

        };
        const pageResult = await pageSkill(command);

       if (pageResult) {
           return pageResult;
       }

    } catch (error) {

        console.error(error);

        return {

            success: false,

            message: "Unable to process your request."

        };

    }

}