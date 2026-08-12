// engine/executionEngine.js

import { routeMessage } from "../agents/messageRouter.js";
import { createExecutionPlan } from "../agents/planner.js";
import { executePlan } from "../agents/actionExecutor.js";

import { buildContext } from "./contextBuilder.js";

import {
    buildConversation,
    saveUserMessage,
    saveAssistantReply
} from "./conversationManager.js";

import { askGemini } from "../services/aiService.js";

export async function execute(userInput) {

    try {

        console.log("[Axis] Starting execution...");

        // ==========================================
        // Save User Message
        // ==========================================

        await saveUserMessage(userInput);

        // ==========================================
        // Build Browser Context
        // ==========================================

        const context = await buildContext();

        console.log("[Axis] Context Loaded");

        // ==========================================
        // Route Message
        // ==========================================

        const route = routeMessage(userInput);

        console.log("[Axis] Route:", route);

        // ==========================================
        // Build Execution Plan
        // ==========================================

        const plan = createExecutionPlan(route.command);

        console.log("[Axis] Plan:", plan);

        // ==========================================
        // Local Tool Execution
        // ==========================================

        if (!plan.requiresAI) {

            const result = await executePlan(plan, userInput);

            return result;

        }

        // ==========================================
        // Build AI Conversation
        // ==========================================

        const conversation = await buildConversation(

            userInput,

            context

        );

        // ==========================================
        // Prompt
        // ==========================================

        const prompt = conversation
            .map(message => {

                return `${message.role.toUpperCase()}:\n${message.content}`;

            })
            .join("\n\n");

        console.log("[Axis] Sending to Gemini...");

        // ==========================================
        // AI Response
        // ==========================================

        const response = await askGemini(prompt);

        // ==========================================
        // Save Assistant Reply
        // ==========================================

        await saveAssistantReply(response);

        return {

            success: true,

            ai: true,

            message: response

        };

    }

    catch (error) {

        console.error("[Axis]", error);

        return {

            success: false,

            ai: false,

            message: error.message

        };

    }

}