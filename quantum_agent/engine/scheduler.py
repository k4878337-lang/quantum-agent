"""
Quantum Autonomous Scheduler
Master orchestrator managing the infinite possibility loop, rate-limit resilience,
state checkpointing, and convergence across hours, days, or months.
"""

import sys
import time
import signal
import uuid
from typing import Optional, Dict, Any

from quantum_agent.core.superposition import SuperpositionEngine
from quantum_agent.core.interference import InterferenceEngine
from quantum_agent.core.tunneling import TunnelingEngine
from quantum_agent.core.convergence import ConvergenceChecker
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.engine.telemetry import LiveTelemetry
from quantum_agent.providers.universal import UniversalAIProvider
from quantum_agent.providers.rate_limiter import RateLimitSentinel


class QuantumScheduler:
    """
    Long-running autonomous scheduler.
    Orchestrates Superposition, Tunneling, and Interference with crash-resilient persistence.
    """

    def __init__(
        self,
        target: str,
        session_id: Optional[str] = None,
        intensity: str = "HIGH",
        provider_name: Optional[str] = None,
        model_name: Optional[str] = None,
        db_path: str = "quantum_agent_memory.db",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        hud_refresh_interval: float = 1.0
    ):
        self.target = target
        self.session_id = session_id or f"qsession-{uuid.uuid4().hex[:8]}"
        self.intensity = intensity.upper()
        self.db = QuantumStateDB(db_path)
        self.provider = UniversalAIProvider(
            provider=provider_name,
            model=model_name,
            api_key=api_key,
            base_url=base_url
        )
        self.telemetry = LiveTelemetry(
            target=target,
            intensity=self.intensity,
            provider=self.provider.get_provider_name()
        )
        self.superposition = SuperpositionEngine(intensity=self.intensity)
        self.interference = InterferenceEngine()
        self.tunneling = TunnelingEngine()
        self.convergence = ConvergenceChecker()
        self.rate_limiter = RateLimitSentinel()
        self.hud_refresh_interval = hud_refresh_interval
        self.is_running = True

        self._setup_signals()

    def _setup_signals(self):
        """Ensures state is saved safely on Ctrl+C or kill signal."""
        def _handle_interrupt(sig, frame):
            print("\n[!] Graceful shutdown signal received. Freezing all quantum states in DB...")
            self.is_running = False
            self.save_checkpoint(status="PAUSED_USER_INTERRUPT")
            print(f"[✓] Session {self.session_id} safely checkpointed. Resume anytime with --resume {self.session_id}")
            sys.exit(0)

        try:
            signal.signal(signal.SIGINT, _handle_interrupt)
            signal.signal(signal.SIGTERM, _handle_interrupt)
        except (ValueError, AttributeError):
            pass # Signals might not be supported in certain threaded environments

    def save_checkpoint(self, status: str = "RUNNING", converged_result: Optional[str] = None):
        """Persists session metadata to SQLite."""
        self.db.update_session(
            session_id=self.session_id,
            accumulated_uptime=self.telemetry.get_elapsed_seconds(),
            total_evaluated=self.telemetry.total_evaluated,
            status=status,
            converged_result=converged_result
        )

    def run(self) -> Dict[str, Any]:
        """
        Executes the autonomous loop until 100% exact convergence is achieved.
        Can run seamlessly for seconds, hours, days, weeks, or months.
        """
        session_info = self.db.create_or_resume_session(
            session_id=self.session_id,
            target=self.target,
            intensity=self.intensity,
            provider=self.provider.provider,
            model=self.provider.model
        )

        # Restore past uptime if resuming an earlier multi-day run
        past_uptime = session_info.get("accumulated_uptime", 0.0)
        past_evaluated = session_info.get("total_evaluated", 0)
        self.telemetry.set_historical_time(past_uptime)
        self.telemetry.update_metrics(evaluated_inc=past_evaluated)

        # Seed initial quantum basis states if database is fresh
        active_count = self.db.count_active_states(self.session_id)
        if active_count == 0:
            basis_states = self.superposition.create_initial_basis_states(self.target)
            for b in basis_states:
                self.db.add_quantum_state(
                    session_id=self.session_id,
                    hypothesis=b["hypothesis"],
                    depth=b["depth"],
                    reasoning=b["reasoning"],
                    score=b["score"],
                    status="SUPERPOSITION"
                )
            active_count = len(basis_states)

        self.telemetry.update_metrics(active=active_count, status="SUPERPOSITION_INITIALIZED")
        self.telemetry.render_hud()

        last_hud_render = time.time()

        # Infinite convergence loop
        while self.is_running:
            batch_size = self.superposition.config["batch_size"]
            pending = self.db.get_pending_states(self.session_id, limit=batch_size)

            if not pending:
                # If all current branches were pruned, spawn fresh orthogonal basis seeds
                self.telemetry.update_metrics(status="GENERATING_NEW_BASIS_VECTORS")
                new_seeds = self.superposition.create_initial_basis_states(f"{self.target} [Epoch-{time.time()}]")
                for s in new_seeds:
                    self.db.add_quantum_state(
                        session_id=self.session_id,
                        hypothesis=s["hypothesis"],
                        depth=1,
                        reasoning="Secondary basis epoch generated",
                        score=0.6,
                        status="SUPERPOSITION"
                    )
                continue

            for state in pending:
                if not self.is_running:
                    break

                # Periodic HUD rendering
                if time.time() - last_hud_render > self.hud_refresh_interval:
                    self.telemetry.update_metrics(
                        active=self.db.count_active_states(self.session_id),
                        status=f"Probing State #{state['state_id']} (Depth {state['depth']})"
                    )
                    self.telemetry.render_hud()
                    last_hud_render = time.time()

                # Generate branch exploration prompt
                prompt = self.superposition.generate_expansion_prompt(self.target, state)
                response = self.provider.generate(prompt)

                # Rate Limit Sentinel handling: Auto-Pause and Auto-Resume
                if response.is_rate_limited:
                    self.telemetry.pause(reason="AI Rate Limit / Quota Exceeded")
                    
                    def on_tick(remaining: float, msg: str):
                        self.telemetry.last_status = f"⏸️ {msg}"
                        self.telemetry.render_hud()

                    self.rate_limiter.handle_rate_limit(
                        provider_name=self.provider.get_provider_name(),
                        provider_suggested=response.retry_after_seconds,
                        on_countdown_tick=on_tick
                    )
                    self.telemetry.resume()
                    self.telemetry.last_status = "▶️ Quota Restored! Resuming exact state..."
                    self.telemetry.render_hud()
                    # Re-attempt this branch with replenished quota
                    continue

                if not response.is_success:
                    # Non-fatal error on this branch, slightly penalize score and continue
                    self.db.update_state_resolution(
                        state_id=state["state_id"],
                        status="SUPERPOSITION",
                        score=max(0.1, state["score"] - 0.1),
                        reasoning=f"Provider warning: {response.error}"
                    )
                    continue

                # Record successful response
                self.rate_limiter.record_success()
                parsed = self.superposition.parse_expansion_response(response.content)

                # Check 100% exact convergence condition
                is_converged, confidence, evidence = self.convergence.verify_solution(
                    target=self.target,
                    solution_code=parsed.get("solution"),
                    parsed_result=parsed
                )

                self.telemetry.update_metrics(
                    evaluated_inc=1,
                    confidence=confidence
                )

                if is_converged:
                    # 100% Exact Solution Found! Collapse the wave function
                    solution_text = parsed.get("solution") or response.content
                    self.db.update_state_resolution(
                        state_id=state["state_id"],
                        status="COLLAPSED_WIN",
                        score=1.0,
                        reasoning=evidence,
                        solution_code=solution_text
                    )
                    self.save_checkpoint(status="CONVERGED", converged_result=solution_text)
                    self.telemetry.update_metrics(
                        active=0,
                        status="🏆 100% EXACT CONVERGENCE ACHIEVED!",
                        confidence=1.0
                    )
                    self.telemetry.render_hud()
                    return {
                        "session_id": self.session_id,
                        "status": "CONVERGED",
                        "uptime": self.telemetry.get_uptime_formatted(),
                        "evaluated_branches": self.telemetry.total_evaluated,
                        "winning_state_id": state["state_id"],
                        "solution": solution_text,
                        "evidence": evidence
                    }

                # Apply Interference (Amplification or Pruning)
                new_status, new_score = self.interference.apply_interference(state, parsed)
                self.db.update_state_resolution(
                    state_id=state["state_id"],
                    status=new_status,
                    score=new_score,
                    reasoning=parsed.get("reasoning", ""),
                    solution_code=parsed.get("solution")
                )

                if new_status == "PRUNED":
                    self.telemetry.update_metrics(pruned_inc=1)
                elif new_status == "SUPERPOSITION":
                    # Spawn child superposition branches
                    children = parsed.get("children", [])
                    curr_depth = state["depth"]
                    max_depth = self.superposition.config["max_depth"]
                    if curr_depth < max_depth:
                        for ch in children:
                            self.db.add_quantum_state(
                                session_id=self.session_id,
                                parent_id=state["state_id"],
                                depth=curr_depth + 1,
                                hypothesis=ch.get("hypothesis", "Derived branch"),
                                reasoning=ch.get("action_plan", ""),
                                score=new_score * 0.95,
                                status="SUPERPOSITION"
                            )

                # Check if stuck in a local optimum -> Trigger Quantum Tunneling
                if self.tunneling.check_stagnation(self.telemetry.best_confidence):
                    tunneled = self.tunneling.execute_tunnel_leap(self.target, state)
                    self.db.add_quantum_state(
                        session_id=self.session_id,
                        parent_id=state["state_id"],
                        depth=tunneled["depth"],
                        hypothesis=tunneled["hypothesis"],
                        reasoning=tunneled["reasoning"],
                        score=tunneled["score"],
                        status="SUPERPOSITION"
                    )
                    self.telemetry.update_metrics(
                        tunneled_inc=1,
                        status="🚇 Quantum Tunnel Leap Dispatched!"
                    )

            # Checkpoint periodically
            self.save_checkpoint(status="RUNNING")

        return {"session_id": self.session_id, "status": "STOPPED"}
