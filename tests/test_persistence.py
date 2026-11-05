"""
Tests for Quantum State Persistence DB and Telemetry
"""

import os
import unittest
import tempfile
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.engine.telemetry import LiveTelemetry


class TestPersistence(unittest.TestCase):

    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.db_path = self.temp_db.name
        self.temp_db.close()
        self.db = QuantumStateDB(self.db_path)

    def tearDown(self):
        self.db.close()
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def test_session_lifecycle(self):
        sess = self.db.create_or_resume_session(
            session_id="test-sess-1",
            target="Solve P vs NP",
            intensity="HIGH",
            provider="simulation",
            model="default"
        )
        self.assertEqual(sess["session_id"], "test-sess-1")
        self.assertEqual(sess["status"], "RUNNING")

        # Add states
        s1 = self.db.add_quantum_state("test-sess-1", "Hypothesis 1", score=0.7)
        s2 = self.db.add_quantum_state("test-sess-1", "Hypothesis 2", score=0.9)
        self.assertEqual(self.db.count_active_states("test-sess-1"), 2)

        # Retrieve pending sorted by score
        pending = self.db.get_pending_states("test-sess-1", limit=10)
        self.assertEqual(len(pending), 2)
        self.assertEqual(pending[0]["hypothesis"], "Hypothesis 2")

        # Update resolution
        self.db.update_state_resolution(s2, "COLLAPSED_WIN", 1.0, solution_code="code_result")
        best = self.db.get_best_solution("test-sess-1")
        self.assertIsNotNone(best)
        self.assertEqual(best["solution_code"], "code_result")

    def test_telemetry_uptime_formatting(self):
        telemetry = LiveTelemetry("Test target", intensity="MEDIUM")
        telemetry.accumulated_seconds = 90061 # 1 day, 1 hour, 1 min, 1 sec
        uptime = telemetry.get_uptime_formatted()
        self.assertIn("1d", uptime)
        self.assertIn("01h", uptime)
        self.assertIn("01m", uptime)


if __name__ == "__main__":
    unittest.main()
