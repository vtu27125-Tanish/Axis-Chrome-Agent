// engine/conversationManager.js

import {
    saveConversation,
    getConversation,
    clearConversation
} from "../services/storageService.js";

const MAX_HISTORY = 20;

/**
 * Save a message into conversation history
 */
export async function addMessage(role, content) {

    await saveConversation({

        role,

        content,

        timestamp: Date.now()

    });

}

/**
 * Returns recent conversation
 */
export async function getHistory() {

    const history = await getConversation();

    return history.slice(-MAX_HISTORY);

}

/**
 * Clears conversation
 */
export async function resetConversation() {

    await clearConversation();

}

/**
 * Builds conversation for Gemini
 */
export async function buildConversation(userMessage, context = {}) {

    const history = await getHistory();

    const messages = [];

    // ==========================
    // System Prompt
    // ==========================

    messages.push({

        role: "system",

        content: `
You are Axis.

Axis is an autonomous AI Browser Agent.

Capabilities:

- Browser Automation
- Web Navigation
- Page Understanding
- Research
- Memory
- File Analysis
- Workflow Execution

Always think step-by-step.

If browser tools are required,
request them instead of hallucinating.

Current Page:

Title: ${context.title || ""}

URL: ${context.url || ""}

`

    });

    // ==========================
    // Previous Conversation
    // ==========================

    for (const msg of history) {

        messages.push({

            role: msg.role,

            content: msg.content

        });

    }

    // ==========================
    // Current User Message
    // ==========================

    messages.push({

        role: "user",

        content: userMessage

    });

    return messages;

}

/**
 * Save assistant reply
 */
export async function saveAssistantReply(reply) {

    await addMessage(

        "assistant",

        reply

    );

}

/**
 * Save user message
 */
export async function saveUserMessage(message) {

    await addMessage(

        "user",

        message

    );

}

/**
 * Returns last assistant reply
 */
export async function getLastAssistantMessage() {

    const history = await getHistory();

    for (let i = history.length - 1; i >= 0; i--) {

        if (history[i].role === "assistant") {

            return history[i];

        }

    }

    return null;

}

/**
 * Returns last user message
 */
export async function getLastUserMessage() {

    const history = await getHistory();

    for (let i = history.length - 1; i >= 0; i--) {

        if (history[i].role === "user") {

            return history[i];

        }

    }

    return null;

}

/**
 * Returns conversation statistics
 */
export async function getConversationStats() {

    const history = await getHistory();

    return {

        totalMessages: history.length,

        userMessages:

            history.filter(

                m => m.role === "user"

            ).length,

        assistantMessages:

            history.filter(

                m => m.role === "assistant"

            ).length

    };

}