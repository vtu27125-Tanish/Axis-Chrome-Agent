"""
backend/db_client.py
Async MySQL-backed replacement for firestore_client.py.
Same method names/signatures as FirestoreClient so backend/main.py needs
only a single import-line change to switch storage backends.
"""
import logging
import uuid
from datetime import datetime, timezone

import aiomysql

from backend.config import settings

logger = logging.getLogger(__name__)


class MySQLClient:
    def __init__(self):
        self._pool = None

    async def _get_pool(self):
        if self._pool is None:
            self._pool = await aiomysql.create_pool(
                host=settings.mysql_host,
                port=settings.mysql_port,
                user=settings.mysql_user,
                password=settings.mysql_password,
                db=settings.mysql_database,
                autocommit=True,
                minsize=1,
                maxsize=5,
            )
        return self._pool

    # ------------------------------------------------------------------
    # User
    # ------------------------------------------------------------------

    async def upsert_user(self, user_id: str, email: str, display_name: str) -> None:
        try:
            pool = await self._get_pool()
            now = datetime.now(timezone.utc)
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO users (user_id, email, display_name, created_at, last_seen_at, input_count, image_count)
                        VALUES (%s, %s, %s, %s, %s, 0, 0)
                        ON DUPLICATE KEY UPDATE
                            email = VALUES(email),
                            display_name = VALUES(display_name),
                            last_seen_at = VALUES(last_seen_at)
                        """,
                        (user_id, email, display_name, now, now),
                    )
            logger.info(f"upsert_user: {user_id}")
        except Exception as e:
            logger.error(f"upsert_user error: {e}")

    async def get_user_counts(self, user_id: str) -> dict:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        "SELECT input_count, image_count, input_limit, image_limit FROM users WHERE user_id = %s",
                        (user_id,),
                    )
                    row = await cur.fetchone()
            if row:
                return {
                    "input_count": row["input_count"] or 0,
                    "image_count": row["image_count"] or 0,
                    "input_limit": row["input_limit"],
                    "image_limit": row["image_limit"],
                }
            return {"input_count": 0, "image_count": 0, "input_limit": None, "image_limit": None}
        except Exception as e:
            logger.error(f"get_user_counts error: {e}")
            return {"input_count": 0, "image_count": 0, "input_limit": None, "image_limit": None}

    async def increment_input_count(self, user_id: str) -> int:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE users SET input_count = input_count + 1 WHERE user_id = %s", (user_id,)
                    )
                    await cur.execute("SELECT input_count FROM users WHERE user_id = %s", (user_id,))
                    row = await cur.fetchone()
            return row[0] if row else 0
        except Exception as e:
            logger.error(f"increment_input_count error: {e}")
            return 0

    async def increment_image_count(self, user_id: str) -> int:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE users SET image_count = image_count + 1 WHERE user_id = %s", (user_id,)
                    )
                    await cur.execute("SELECT image_count FROM users WHERE user_id = %s", (user_id,))
                    row = await cur.fetchone()
            return row[0] if row else 0
        except Exception as e:
            logger.error(f"increment_image_count error: {e}")
            return 0

    # ------------------------------------------------------------------
    # Session CRUD
    # ------------------------------------------------------------------

    async def create_session(
        self, user_id: str, session_id: str, page_url: str, page_title: str,
        session_type: str = "live",
    ) -> None:
        try:
            pool = await self._get_pool()
            now = datetime.now(timezone.utc)
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO sessions (session_id, user_id, started_at, ended_at, page_url, page_title, session_headline, session_type)
                        VALUES (%s, %s, %s, NULL, %s, %s, '', %s)
                        ON DUPLICATE KEY UPDATE page_url = VALUES(page_url), page_title = VALUES(page_title)
                        """,
                        (session_id, user_id, now, page_url, page_title, session_type),
                    )
            logger.info(f"create_session: {session_id} type={session_type}")
        except Exception as e:
            logger.error(f"create_session error: {e}")

    async def append_transcript(
        self, user_id: str, session_id: str, role: str, text: str, timestamp: str
    ) -> None:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "INSERT INTO transcript_entries (session_id, role, text, timestamp) VALUES (%s, %s, %s, %s)",
                        (session_id, role, text, timestamp),
                    )
            logger.debug(f"append_transcript: {role} in {session_id}")
        except Exception as e:
            logger.error(f"append_transcript error: {e}")

    async def end_session(
        self, user_id: str, session_id: str, session_headline: str
    ) -> None:
        try:
            pool = await self._get_pool()
            now = datetime.now(timezone.utc)
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "UPDATE sessions SET ended_at = %s, session_headline = %s WHERE session_id = %s",
                        (now, session_headline, session_id),
                    )
            logger.info(f"end_session: {session_id} headline={session_headline!r}")
        except Exception as e:
            logger.error(f"end_session error: {e}")

    async def get_recent_sessions(self, user_id: str, limit: int = 10) -> list:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        """
                        SELECT s.session_id, s.user_id, s.started_at, s.ended_at,
                               s.page_url, s.page_title, s.session_headline, s.session_type,
                               COUNT(t.id) AS transcript_count
                        FROM sessions s
                        LEFT JOIN transcript_entries t ON t.session_id = s.session_id
                        WHERE s.user_id = %s
                        GROUP BY s.session_id
                        ORDER BY s.started_at DESC
                        LIMIT %s
                        """,
                        (user_id, limit),
                    )
                    rows = await cur.fetchall()
            results = []
            for row in rows:
                for key in ("started_at", "ended_at"):
                    val = row.get(key)
                    if val is not None and hasattr(val, "isoformat"):
                        row[key] = val.isoformat()
                results.append(row)
            return results
        except Exception as e:
            logger.error(f"get_recent_sessions error: {e}")
            return []

    async def get_session_transcript(self, user_id: str, session_id: str) -> list:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        "SELECT role, text, timestamp FROM transcript_entries WHERE session_id = %s ORDER BY id ASC",
                        (session_id,),
                    )
                    rows = await cur.fetchall()
            return rows
        except Exception as e:
            logger.error(f"get_session_transcript error: {e}")
            return []

    async def delete_session(self, user_id: str, session_id: str) -> None:
        try:
            pool = await self._get_pool()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("DELETE FROM transcript_entries WHERE session_id = %s", (session_id,))
                    await cur.execute("DELETE FROM session_files WHERE session_id = %s", (session_id,))
                    await cur.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
            logger.info(f"delete_session: {session_id}")
        except Exception as e:
            logger.error(f"delete_session error: {e}")

    async def store_session_file(
        self, user_id: str, session_id: str, filename: str, mime_type: str, data: str
    ) -> None:
        try:
            file_id = str(uuid.uuid4())
            pool = await self._get_pool()
            now = datetime.now(timezone.utc)
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "INSERT INTO session_files (file_id, session_id, filename, mime_type, data, uploaded_at) VALUES (%s, %s, %s, %s, %s, %s)",
                        (file_id, session_id, filename, mime_type, data, now),
                    )
            logger.info(f"store_session_file: {filename}")
        except Exception as e:
            logger.error(f"store_session_file error: {e}")


# Singleton instance
db_client = MySQLClient()