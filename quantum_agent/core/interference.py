"""
Quantum Interference Engine: Amplitude Amplification & Destructive Pruning
Inspired by Grover's Algorithm to amplify winning solutions and cancel out dead ends.
"""

from typing import List, Dict, Any, Tuple


class InterferenceEngine:
    """
    Applies constructive interference (amplifying high-potential branches)
    and destructive interference (pruning low-scoring or redundant branches).
    """

    def __init__(self, pruning_threshold: float = 0.35, amplification_threshold: float = 0.75):
        self.pruning_threshold = pruning_threshold
        self.amplification_threshold = amplification_threshold

    def apply_interference(
        self,
        evaluated_state: Dict[str, Any],
        parsed_result: Dict[str, Any]
    ) -> Tuple[str, float]:
        """
        Determines the fate of an evaluated branch:
        Returns: (new_status, adjusted_score)
        where new_status is one of:
        - 'COLLAPSED_WIN': Target completely solved
        - 'SUPERPOSITION': Still active with amplified or maintained amplitude
        - 'PRUNED': Cancelled via destructive interference
        """
        if parsed_result.get("is_exact_solution"):
            return "COLLAPSED_WIN", 1.0

        raw_score = float(parsed_result.get("score", 0.5))

        # Destructive interference: cancel dead ends
        if raw_score < self.pruning_threshold:
            return "PRUNED", raw_score

        # Constructive interference: Grover amplitude amplification
        if raw_score >= self.amplification_threshold:
            # Boost score towards 1.0
            amplified_score = min(0.99, raw_score + (1.0 - raw_score) * 0.25)
            return "SUPERPOSITION", amplified_score

        return "SUPERPOSITION", raw_score

    def rank_and_filter_candidates(
        self,
        branches: List[Dict[str, Any]],
        keep_top_k: int = 50
    ) -> List[Dict[str, Any]]:
        """Sorts branches by score and drops redundant lower-tier candidates."""
        sorted_branches = sorted(branches, key=lambda b: b.get("score", 0.0), reverse=True)
        return sorted_branches[:keep_top_k]
