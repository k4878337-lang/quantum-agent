"""
Tests for Superposition, Interference, and Tunneling Engines
"""

import unittest
from quantum_agent.core.superposition import SuperpositionEngine
from quantum_agent.core.interference import InterferenceEngine
from quantum_agent.core.tunneling import TunnelingEngine
from quantum_agent.core.convergence import ConvergenceChecker


class TestQuantumCore(unittest.TestCase):

    def test_superposition_basis_states(self):
        engine = SuperpositionEngine(intensity="HIGH")
        states = engine.create_initial_basis_states("Test Target Problem")
        self.assertGreaterEqual(len(states), 4)
        for s in states:
            self.assertIn("hypothesis", s)
            self.assertEqual(s["depth"], 1)

    def test_interference_pruning_and_amplification(self):
        engine = InterferenceEngine(pruning_threshold=0.35, amplification_threshold=0.75)
        
        # Test pruning
        prune_state, prune_score = engine.apply_interference(
            {"hypothesis": "h"}, {"score": 0.2, "is_exact_solution": False}
        )
        self.assertEqual(prune_state, "PRUNED")

        # Test amplification
        amp_state, amp_score = engine.apply_interference(
            {"hypothesis": "h"}, {"score": 0.8, "is_exact_solution": False}
        )
        self.assertEqual(amp_state, "SUPERPOSITION")
        self.assertGreater(amp_score, 0.8)

        # Test collapse win
        win_state, win_score = engine.apply_interference(
            {"hypothesis": "h"}, {"score": 0.9, "is_exact_solution": True}
        )
        self.assertEqual(win_state, "COLLAPSED_WIN")
        self.assertEqual(win_score, 1.0)

    def test_tunneling_leap(self):
        tunnel = TunnelingEngine(stagnation_threshold=3)
        self.assertFalse(tunnel.check_stagnation(0.5))    # Sets baseline (0)
        self.assertFalse(tunnel.check_stagnation(0.51))   # Stagnant 1
        self.assertFalse(tunnel.check_stagnation(0.512))  # Stagnant 2
        self.assertTrue(tunnel.check_stagnation(0.515))   # Stagnant 3 (meets threshold)

        leap = tunnel.execute_tunnel_leap("Test Problem", {"state_id": 1, "depth": 2})
        self.assertIn("[QUANTUM TUNNEL:", leap["hypothesis"])
        self.assertEqual(leap["depth"], 3)

    def test_convergence_checker(self):
        checker = ConvergenceChecker()
        valid, conf, ev = checker.verify_solution(
            target="Write a python function",
            solution_code="def solve():\n    return 42",
            parsed_result={"is_exact_solution": True, "reasoning": "Complete proof"}
        )
        self.assertTrue(valid)
        self.assertEqual(conf, 1.0)

        # Syntax error test
        invalid, _, _ = checker.verify_solution(
            target="Write python code",
            solution_code="def broken(:\n return",
            parsed_result={"is_exact_solution": True}
        )
        self.assertFalse(invalid)


if __name__ == "__main__":
    unittest.main()
