import sys
import os
import asyncio

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.rag_service import add_document, search_knowledge_base

async def main():
    print("Testing RAG insertion...")
    res = await add_document(
        "test_user", 
        "Axis Chrome Agent is a powerful browser assistant powered by Gemini. It can interact with web pages and now it has RAG capabilities!"
    )
    print("Insert Result:", res)

    print("\nTesting RAG search...")
    results = await search_knowledge_base("test_user", "What is Axis Chrome Agent?")
    print("Search Results:")
    for r in results:
        print(f"Score: {r['score']:.4f} | Text: {r['text']}")

if __name__ == "__main__":
    asyncio.run(main())
