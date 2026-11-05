"""
Quantum System Management & Dual-Mode Controller
Manages two distinct execution paradigms:
1. HOST_AI_CONTROLLED: When connected via MCP / IDE / Chat (Gemini, Claude, ChatGPT).
   The connected Host AI acts as the primary reasoning engine; external API keys are NOT required.
2. STANDALONE_TERMINAL: When executing headless via terminal CLI.
   Requires configured AI provider (Gemini, Claude, OpenAI, Ollama) and manages autonomous API loops.
"""

from enum import Enum
from typing import Dict, Any, Optional, List
from quantum_agent.core.superposition import SuperpositionEngine
from quantum_agent.core.interference import InterferenceEngine
from quantum_agent.core.tunneling import TunnelingEngine
from quantum_agent.core.convergence import ConvergenceChecker
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.engine.telemetry import LiveTelemetry


class ExecutionMode(str, Enum):
    HOST_AI_CONTROLLED = "HOST_AI_CONTROLLED"   # MCP / Host AI (Gemini, Claude, ChatGPT) in direct control
    STANDALONE_TERMINAL = "STANDALONE_TERMINAL" # Headless CLI with provider API keys


class QuantumSystemManager:
    """
    Core orchestrator that adapts execution based on the operating environment.
    """

    def __init__(self, mode: ExecutionMode = ExecutionMode.HOST_AI_CONTROLLED, db_path: str = "quantum_agent_memory.db"):
        self.mode = mode
        self.db = QuantumStateDB(db_path)
        self.superposition = SuperpositionEngine()
        self.interference = InterferenceEngine()
        self.tunneling = TunnelingEngine()
        self.convergence = ConvergenceChecker()

    def get_system_status(self) -> Dict[str, Any]:
        return {
            "mode": self.mode.value,
            "description": (
                "Host AI (Gemini / Claude / ChatGPT) is in full direct control via MCP. "
                "No external API keys required."
                if self.mode == ExecutionMode.HOST_AI_CONTROLLED
                else "Standalone Terminal CLI mode. Managed providers and rate limits are active."
            ),
            "persistence_db": self.db.db_path,
            "active_sessions": len(self.db.list_all_sessions())
        }

    # =========================================================================
    # HOST_AI_CONTROLLED Operations (Zero API keys needed; Host AI is the brain)
    # =========================================================================

    def host_init_task(self, target: str, intensity: str = "HIGH", session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Initializes a task for a connected Host AI (Gemini, Claude, ChatGPT).
        Generates initial orthogonal basis vectors and seeds the persistent graph.
        """
        import uuid
        sid = session_id or f"host-qsession-{uuid.uuid4().hex[:8]}"
        self.superposition = SuperpositionEngine(intensity=intensity)

        session = self.db.create_or_resume_session(
            session_id=sid,
            target=target,
            intensity=intensity,
            provider="HOST_CONNECTED_AI",
            model="HOST_NATIVE"
        )

        # Create orthogonal basis states
        basis_states = self.superposition.create_initial_basis_states(target)
        seeded_ids = []
        for b in basis_states:
            s_id = self.db.add_quantum_state(
                session_id=sid,
                hypothesis=b["hypothesis"],
                depth=b["depth"],
                reasoning=b["reasoning"],
                score=b["score"],
                status="SUPERPOSITION"
            )
            seeded_ids.append({"state_id": s_id, "hypothesis": b["hypothesis"]})

        return {
            "session_id": sid,
            "mode": ExecutionMode.HOST_AI_CONTROLLED.value,
            "target": target,
            "intensity": intensity,
            "initial_basis_states": seeded_ids,
            "instruction_for_host_ai": (
                "You are the Host Brain in control of the Quantum Agent. "
                "Pick one or more basis states, evaluate them, and call 'quantum_step' "
                "with your evaluations, confidence scores, and newly derived branches."
            )
        }

    def host_step(
        self,
        session_id: str,
        state_id: int,
        evaluation_score: float,
        is_exact_solution: bool,
        reasoning: str,
        solution_code_or_proof: Optional[str] = None,
        child_branches: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """
        Processes an evaluation step submitted directly by the Host AI.
        Applies constructive/destructive interference, tests convergence, and returns next priorities.
        """
        # Fetch current state
        pending = self.db.get_pending_states(session_id, limit=500)
        curr_state = next((s for s in pending if s["state_id"] == state_id), None)
        if not curr_state:
            return {"error": f"State ID #{state_id} not found or already collapsed in session {session_id}."}

        # Convergence test
        is_converged, confidence, evidence = self.convergence.verify_solution(
            target=curr_state.get("hypothesis", ""),
            solution_code=solution_code_or_proof,
            parsed_result={
                "is_exact_solution": is_exact_solution,
                "score": evaluation_score,
                "reasoning": reasoning
            }
        )

        if is_converged:
            self.db.update_state_resolution(
                state_id=state_id,
                status="COLLAPSED_WIN",
                score=1.0,
                reasoning=evidence,
                solution_code=solution_code_or_proof
            )
            self.db.update_session(
                session_id=session_id,
                accumulated_uptime=0.0,
                total_evaluated=self.db.count_active_states(session_id),
                status="CONVERGED",
                converged_result=solution_code_or_proof
            )
            return {
                "session_id": session_id,
                "status": "COLLAPSED_WIN",
                "converged": True,
                "message": "🏆 Exact 100% convergence verified! Solution state collapsed successfully.",
                "solution": solution_code_or_proof,
                "evidence": evidence
            }

        # Apply Interference (Amplification or Pruning)
        new_status, new_score = self.interference.apply_interference(
            curr_state,
            {"score": evaluation_score, "is_exact_solution": False}
        )
        self.db.update_state_resolution(
            state_id=state_id,
            status=new_status,
            score=new_score,
            reasoning=reasoning,
            solution_code=solution_code_or_proof
        )

        # Spawn child branches if alive
        added_children = []
        if new_status == "SUPERPOSITION" and child_branches:
            curr_depth = curr_state.get("depth", 1)
            for ch in child_branches:
                child_id = self.db.add_quantum_state(
                    session_id=session_id,
                    parent_id=state_id,
                    depth=curr_depth + 1,
                    hypothesis=ch.get("hypothesis", "Derived state"),
                    reasoning=ch.get("action_plan", ""),
                    score=new_score * 0.95,
                    status="SUPERPOSITION"
                )
                added_children.append(child_id)

        # Check for stagnation / quantum tunnel leap
        tunnel_event = None
        if self.tunneling.check_stagnation(new_score):
            leap = self.tunneling.execute_tunnel_leap(curr_state.get("hypothesis", ""), curr_state)
            tid = self.db.add_quantum_state(
                session_id=session_id,
                parent_id=state_id,
                depth=leap["depth"],
                hypothesis=leap["hypothesis"],
                reasoning=leap["reasoning"],
                score=leap["score"],
                status="SUPERPOSITION"
            )
            tunnel_event = {"state_id": tid, "leap": leap}

        # Return next active candidates ranked by amplitude
        next_candidates = self.db.get_pending_states(session_id, limit=5)

        return {
            "session_id": session_id,
            "evaluated_state_id": state_id,
            "status": new_status,
            "amplified_score": round(new_score, 4),
            "children_spawned": len(added_children),
            "quantum_tunnel_event": tunnel_event,
            "active_superposition_count": self.db.count_active_states(session_id),
            "next_top_priority_branches": [
                {"state_id": s["state_id"], "depth": s["depth"], "score": round(s["score"], 3), "hypothesis": s["hypothesis"]}
                for s in next_candidates
            ]
        }
