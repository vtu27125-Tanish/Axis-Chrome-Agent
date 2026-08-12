// engine/toolExecutor.js

import { executeBrowserCommand } from "../agents/browserAgent.js";
import { askGemini } from "../services/aiService.js";
import { buildContext } from "./contextBuilder.js";

export async function executeTools(plan, userMessage) {

    const results = [];

    const context = await buildContext();

    for (const tool of plan.tools) {

        switch (tool) {

            // ====================================
            // Browser
            // ====================================

            case "browser": {

                const result =
                    await executeBrowserCommand(
                        plan.originalCommand
                    );

                results.push({

                    tool,

                    result

                });

                break;

            }

            // ====================================
            // Page AI
            // ====================================

            case "page": {

                const prompt = `

You are Axis AI.

Current Page

Title:
${context.title}

URL:
${context.url}

Content:
${context.pageContent}

User Request:
${userMessage}

`;

                const answer =
                    await askGemini(prompt);

                results.push({

                    tool,

                    result: answer

                });

                break;

            }

            // ====================================
            // Memory
            // ====================================

            case "memory": {

                results.push({

                    tool,

                    result: "Memory Tool Ready"

                });

                break;

            }

            // ====================================
            // Reminder
            // ====================================

            case "reminder": {

                results.push({

                    tool,

                    result: "Reminder Created"

                });

                break;

            }

            // ====================================
            // Research
            // ====================================

            case "research": {

                const prompt = `

Research Request

${userMessage}

`;

                const report =
                    await askGemini(prompt);

                results.push({

                    tool,

                    result: report

                });

                break;

            }

            default:

                results.push({

                    tool,

                    result: "Unsupported Tool"

                });

        }

    }

    return results;

}