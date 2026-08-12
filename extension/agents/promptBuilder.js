export function buildPrompt(userMessage, context) {

    return `
You are Axis AI.

Current Page Title:
${context.title}

Current URL:
${context.url}

Selected Text:
${context.selectedText}

Current Page Content:
${context.pageContent}

User Request:
${userMessage}

Answer naturally and use the page context whenever it is relevant.
`;

}