// services/aiService.js

const IS_PROD = false;

// Local Backend
const LOCAL_BACKEND = "http://127.0.0.1:8080";

// Future Production Backend
const PROD_BACKEND = "https://your-domain.com";

const BACKEND_HTTP = IS_PROD
    ? PROD_BACKEND
    : LOCAL_BACKEND;

// ======================================
// Generic Gemini Request
// ======================================

export async function askGemini(prompt, context = null) {

    try {

        const response = await fetch(`${BACKEND_HTTP}/api/chat`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                prompt,
                context
            })

        });

        if (!response.ok) {
            throw new Error(`Backend Error: ${response.status}`);
        }

        const data = await response.json();

        return data.response;

    } catch (error) {

        console.error("[AI Service]", error);

        return "Failed to connect to Axis Backend.";

    }

}

// ======================================
// Page AI Helper
// ======================================

async function callPageAPI(endpoint, pageData) {

    try {

        const response = await fetch(`${BACKEND_HTTP}${endpoint}`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(pageData)

        });

        if (!response.ok) {
            throw new Error(`Backend Error: ${response.status}`);
        }

        return await response.json();

    } catch (error) {

        console.error("[Page API]", error);

        return {
            success: false,
            response: "Failed to connect to backend."
        };

    }

}

// ======================================
// Page AI
// ======================================

export function summarizePage(pageData) {
    return callPageAPI("/api/summarize", pageData);
}

export function generateNotes(pageData) {
    return callPageAPI("/api/notes", pageData);
}

export function explainPage(pageData) {
    return callPageAPI("/api/explain", pageData);
}

export function translatePage(pageData) {
    return callPageAPI("/api/translate", pageData);
}

// ======================================
// Future Agent API
// ======================================

export async function askAgent(payload) {

    try {

        const response = await fetch(`${BACKEND_HTTP}/api/agent`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(payload)

        });

        if (!response.ok) {
            throw new Error(`Backend Error: ${response.status}`);
        }

        return await response.json();

    } catch (error) {

        console.error("[Agent API]", error);

        return {
            success: false,
            message: "Agent execution failed."
        };

    }

}