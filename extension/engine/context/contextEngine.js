import { buildContext } from "../contextBuilder.js";

export async function getCurrentContext() {

    const browserContext = await buildContext();

    return {

        browser: {

            title: browserContext.title,

            url: browserContext.url,

            pageContent: browserContext.pageContent,

            selectedText: browserContext.selectedText,

            html: browserContext.html,

            metadata: browserContext.metadata

        },

        capabilities: {

            browser: true,

            pageReader: true,

            memory: true,

            research: true,

            automation: true

        },

        timestamp: browserContext.timestamp

    };

}