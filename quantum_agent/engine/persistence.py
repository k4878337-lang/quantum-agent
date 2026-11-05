"""
Quantum State Persistence & Crash-Resilient Checkpointing
Stores state branches, telemetry, and checkpoint history in SQLite.
"""

import os
import json
import sqlite3
import time
from typing import List, Dict, Any, Optional


class QuantumStateDB:
    """
    Manages persistent memory and unlimited possibilities state-space.
    Allows long-haul execution spanning days, weeks, or months without memory leaks.
    """

    def __init__(self, db_path: str = "quantum_agent_memory.db"):
        self.db_path = os.path.abspath(db_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self):
        with self.conn:
            # Enable WAL mode for high concurrency & resilience
            self.conn.execute("PRAGMA journal_mode=WAL;")
            self.conn.execute("PRAGMA synchronous=NORMAL;")

            # Sessions table
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    target TEXT NOT NULL,
                    intensity TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    accumulated_uptime REAL DEFAULT 0,
                    status TEXT NOT NULL,
                    total_evaluated INTEGER DEFAULT 0,
                    converged_result TEXT
                );
            """)

            # Quantum States / Branches table (Infinite Possibility Graph)
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS quantum_states (
                    state_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    parent_id INTEGER,
                    depth INTEGER DEFAULT 0,
                    hypothesis TEXT NOT NULL,
                    reasoning TEXT,
                    solution_code TEXT,
                    score REAL DEFAULT 0.0,
                    status TEXT NOT NULL, /* SUPERPOSITION, PRUNED, TUNNELED, COLLAPSED_WIN */
                    metadata_json TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
                );
            """)

            # Fast index lookups for infinite possibility state queries
            self.conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_states_session_status 
                ON quantum_states(session_id, status, score DESC);
            """)

            self.conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_states_parent 
                ON quantum_states(session_id, parent_id);
            """)

    def create_or_resume_session(
        self,
        session_id: str,
        target: str,
        intensity: str,
        provider: str,
        model: str
    ) -> Dict[str, Any]:
        """Creates a new session or retrieves an existing one to resume."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,))
        row = cursor.fetchone()

        now = time.time()
        if row:
            # Resuming existing session
            return dict(row)
        else:
            with self.conn:
                self.conn.execute("""
                    INSERT INTO sessions (
                        session_id, target, intensity, provider, model,
                        created_at, updated_at, accumulated_uptime, status, total_evaluated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'RUNNING', 0)
                """, (session_id, target, intensity, provider, model, now, now))
            return {
                "session_id": session_id,
                "target": target,
                "intensity": intensity,
                "provider": provider,
                "model": model,
                "created_at": now,
                "updated_at": now,
                "accumulated_uptime": 0.0,
                "status": "RUNNING",
                "total_evaluated": 0,
                "converged_result": None
            }

    def update_session(
        self,
        session_id: str,
        accumulated_uptime: float,
        total_evaluated: int,
        status: str,
        converged_result: Optional[str] = None
    ):
        with self.conn:
            self.conn.execute("""
                UPDATE sessions 
                SET updated_at = ?, accumulated_uptime = ?, total_evaluated = ?, status = ?, converged_result = ?
                WHERE session_id = ?
            """, (time.time(), accumulated_uptime, total_evaluated, status, converged_result, session_id))

    def add_quantum_state(
        self,
        session_id: str,
        hypothesis: str,
        parent_id: Optional[int] = None,
        depth: int = 0,
        reasoning: str = "",
        solution_code: str = "",
        score: float = 0.0,
        status: str = "SUPERPOSITION",
        metadata: Optional[dict] = None
    ) -> int:
        """Adds a new possibility state into the superposition graph."""
        now = time.time()
        meta_str = json.dumps(metadata or {})
        with self.conn:
            cursor = self.conn.execute("""
                INSERT INTO quantum_states (
                    session_id, parent_id, depth, hypothesis, reasoning,
                    solution_code, score, status, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id, parent_id, depth, hypothesis, reasoning,
                solution_code, score, status, meta_str, now, now
            ))
            return cursor.lastrowid

    def get_pending_states(self, session_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Retrieves active superposition branches prioritized by score and depth."""
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM quantum_states 
            WHERE session_id = ? AND status = 'SUPERPOSITION' 
            ORDER BY score DESC, depth ASC, state_id ASC 
            LIMIT ?
        """, (session_id, limit))
        return [dict(r) for r in cursor.fetchall()]

    def count_active_states(self, session_id: str) -> int:
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT COUNT(*) FROM quantum_states 
            WHERE session_id = ? AND status = 'SUPERPOSITION'
        """, (session_id,))
        return cursor.fetchone()[0]

    def get_state_by_id(self, state_id: int) -> Optional[Dict[str, Any]]:
        """Retrieves a specific quantum state by its primary ID."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM quantum_states WHERE state_id = ?", (state_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def update_state_resolution(
        self,
        state_id: int,
        status: str,
        score: float,
        reasoning: Optional[str] = None,
        solution_code: Optional[str] = None
    ):
        with self.conn:
            self.conn.execute("""
                UPDATE quantum_states 
                SET status = ?, score = ?, reasoning = COALESCE(?, reasoning),
                    solution_code = COALESCE(?, solution_code), updated_at = ?
                WHERE state_id = ?
            """, (status, score, reasoning, solution_code, time.time(), state_id))

    def get_best_solution(self, session_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("""
            SELECT * FROM quantum_states 
            WHERE session_id = ? AND status = 'COLLAPSED_WIN' 
            ORDER BY score DESC LIMIT 1
        """, (session_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def list_all_sessions(self) -> List[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
        return [dict(r) for r in cursor.fetchall()]

    def close(self):
        self.conn.close()
