// engine/executionEngine.js

import { routeMessage } from "../agents/messageRouter.js";
import { createExecutionPlan } from "../agents/planner.js";
import { executeTools } from "./toolExecutor.js";

import { buildContext } from "./contextBuilder.js";

import {
    saveUserMessage,
    saveAssistantReply,
    buildConversation
} from "./conversationManager.js";

import { askGemini } from "../services/aiService.js";

export async function execute(userInput) {

    try {

        console.log("========== AXIS EXECUTION ==========");

        console.log("User:", userInput);

        // -----------------------------------
        // Save User Message
        // -----------------------------------

        await saveUserMessage(userInput);

        // -----------------------------------
        // Build Browser Context
        // -----------------------------------

        const context = await buildContext();

        console.log("Context Loaded");

        // -----------------------------------
        // Route Message
        // -----------------------------------

        const route = routeMessage(userInput);

        console.log("Route:", route);

        // -----------------------------------
        // Build Plan
        // -----------------------------------

        const plan = createExecutionPlan(route.command);

        console.log("Plan:", plan);

        // -----------------------------------
        // Execute Local Tools
        // -----------------------------------

        if (plan.tools.length > 0) {

            const toolResults =
                await executeTools(
                    plan,
                    userInput
                );

            console.log("Tool Results:", toolResults);

            // If this was only browser work,
            // return immediately.

            if (!plan.requiresAI) {

                return {

                    success: true,

                    tools: toolResults

                };

            }

        }

        // -----------------------------------
        // Build Conversation
        // -----------------------------------

        const conversation =
            await buildConversation(

                userInput,

                context

            );

        const prompt = conversation
            .map(

                message =>

                    `${message.role.toUpperCase()}:\n${message.content}`

            )
            .join("\n\n");

        console.log("Sending to Gemini...");

        // -----------------------------------
        // AI Response
        // -----------------------------------

        const response =
            await askGemini(prompt);

        await saveAssistantReply(response);

        return {

            success: true,

            ai: true,

            message: response

        };

    }

    catch (error) {

        console.error(error);

        return {

            success: false,

            message: error.message

        };

    }

}