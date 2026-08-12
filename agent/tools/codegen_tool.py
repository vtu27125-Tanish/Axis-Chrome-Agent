"""
agent/tools/codegen_tool.py
Tool for generating code snippets via the backend REST endpoint.

The live voice agent (Gemini Live, audio-only) cannot emit a text code
block on its own — everything it produces gets spoken and transcribed.
This tool routes code requests through a text-only Gemini call on the
backend and pushes the result straight to the client over the websocket
(see backend/main.py's function_response forwarding), so code shows up
as text in the live transcript panel instead of being read aloud or
refused.
"""
import httpx
import logging
from google.adk.tools import FunctionTool
from backend.config import settings

logger = logging.getLogger(__name__)

async def generate_code(description: str, language: str = "", session_id: str = "") -> dict:
    """
    Generate a code snippet from a description and display it to the user
    as text in the panel — never speak code aloud.
    Use this whenever the user asks you to write, fix, or show code.
    Args:
        description: what the code should do (e.g. "a Python function that reverses a string").
        language: the programming language, if the user specified one (e.g. "python", "javascript"). Leave blank if unspecified.
        session_id: current session ID.
    """
    url = f"{settings.backend_url}/generate-code"
    payload = {
        "description": description,
        "language": language,
        "session_id": session_id,
    }

    logger.info(f"Tool calling generate-code with description: {description[:60]}...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error in generate_code tool: {e}")
            return {"success": False, "error": str(e)}

generate_code_tool = FunctionTool(func=generate_code)
