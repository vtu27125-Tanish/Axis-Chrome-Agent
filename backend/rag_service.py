import os
import json
import logging
import asyncio
import numpy as np
from typing import List, Dict, Any, Tuple
from google import genai

logger = logging.getLogger(__name__)

# Lightweight in-memory vector DB backed by JSON
RAG_DB_FILE = os.path.join(os.path.dirname(__file__), "rag_db.json")

# In-memory storage: user_id -> list of chunks
# chunk format: {"text": str, "source": str, "vector": list[float]}
_vector_db: Dict[str, List[Dict[str, Any]]] = {}

def _load_db():
    global _vector_db
    if os.path.exists(RAG_DB_FILE):
        try:
            with open(RAG_DB_FILE, "r", encoding="utf-8") as f:
                _vector_db = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load RAG DB: {e}")
            _vector_db = {}

def _save_db():
    try:
        with open(RAG_DB_FILE, "w", encoding="utf-8") as f:
            json.dump(_vector_db, f)
    except Exception as e:
        logger.error(f"Failed to save RAG DB: {e}")

# Load initially
_load_db()

def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Basic sliding window chunker."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        if chunk:
            chunks.append(chunk)
        i += (chunk_size - overlap)
    return chunks

async def _get_embeddings(texts: List[str]) -> List[List[float]]:
    """Get embeddings using Gemini text-embedding-004."""
    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logger.warning("No GOOGLE_API_KEY, cannot generate embeddings.")
        return []
    
    client = genai.Client(api_key=api_key)
    try:
        result = await client.aio.models.embed_content(
            model="text-embedding-004",
            contents=texts
        )
        # Handle multiple returned embeddings
        return [emb.values for emb in result.embeddings]
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        return []

async def add_document(user_id: str, text: str, source: str = "knowledge_base"):
    """Chunk a document, embed it, and add to the user's vector store."""
    if not user_id:
        return {"success": False, "error": "No user ID"}
    
    if not text.strip():
        return {"success": False, "error": "Empty text"}

    chunks = _chunk_text(text)
    if not chunks:
        return {"success": False, "error": "Could not extract chunks"}

    embeddings = await _get_embeddings(chunks)
    if not embeddings or len(embeddings) != len(chunks):
        return {"success": False, "error": "Failed to generate embeddings"}

    if user_id not in _vector_db:
        _vector_db[user_id] = []

    for chunk, vector in zip(chunks, embeddings):
        _vector_db[user_id].append({
            "text": chunk,
            "source": source,
            "vector": vector
        })

    # Save to disk asynchronously
    await asyncio.to_thread(_save_db)
    
    return {"success": True, "chunks_added": len(chunks)}


def _cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    v1 = np.array(vec1)
    v2 = np.array(vec2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return np.dot(v1, v2) / (norm1 * norm2)

async def search_knowledge_base(user_id: str, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """Search for relevant context using cosine similarity."""
    if user_id not in _vector_db or not _vector_db[user_id]:
        return []

    # Embed query
    query_embeds = await _get_embeddings([query])
    if not query_embeds:
        return []
    
    query_vec = query_embeds[0]
    
    # Calculate similarities
    results = []
    for item in _vector_db[user_id]:
        sim = _cosine_similarity(query_vec, item["vector"])
        results.append((sim, item))
    
    # Sort by similarity descending
    results.sort(key=lambda x: x[0], reverse=True)
    
    # Return top_k
    top_results = []
    for sim, item in results[:top_k]:
        top_results.append({
            "text": item["text"],
            "source": item["source"],
            "score": float(sim)
        })
        
    return top_results
