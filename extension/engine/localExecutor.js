import { executePlan } from "../agents/actionExecutor.js";

export async function executeLocal(plan, userMessage) {

    try {

        return await executePlan(plan, userMessage);

    } catch (error) {

        console.error("[Local Executor]", error);

        return {

            success: false,

            message: "Local execution failed."

        };

    }

}