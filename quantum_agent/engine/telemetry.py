"""
Live Telemetry & Real-Time Monitoring HUD for Quantum Agent
Tracks continuous runtime across seconds, days, weeks, and months.
"""

import sys
import time
import datetime
from typing import Optional


class LiveTelemetry:
    """
    Tracks runtime, evaluated branches, active states, and renders a live HUD.
    Supports persistent long-running execution across days, weeks, and months.
    """

    def __init__(self, target: str, intensity: str = "HIGH", provider: str = "universal"):
        self.target = target
        self.intensity = intensity.upper()
        self.provider = provider
        self.start_time = time.time()
        self.accumulated_seconds = 0.0
        self.total_evaluated = 0
        self.active_branches = 0
        self.pruned_branches = 0
        self.tunneled_branches = 0
        self.last_status = "INITIALIZING"
        self.is_paused = False
        self.pause_reason = ""
        self.best_confidence = 0.0

    def set_historical_time(self, past_seconds: float):
        """Used when resuming an existing long-term session."""
        self.accumulated_seconds = past_seconds

    def get_elapsed_seconds(self) -> float:
        current_run = time.time() - self.start_time if not self.is_paused else 0.0
        return self.accumulated_seconds + current_run

    def get_uptime_formatted(self) -> str:
        """Returns uptime in human-readable Days, Hours, Minutes, Seconds format."""
        total_sec = int(self.get_elapsed_seconds())
        days, rem = divmod(total_sec, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, seconds = divmod(rem, 60)
        
        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0 or days > 0:
            parts.append(f"{hours:02d}h")
        parts.append(f"{minutes:02d}m")
        parts.append(f"{seconds:02d}s")
        return " ".join(parts)

    def pause(self, reason: str):
        if not self.is_paused:
            self.accumulated_seconds += (time.time() - self.start_time)
            self.is_paused = True
            self.pause_reason = reason
            self.last_status = f"PAUSED: {reason}"

    def resume(self):
        if self.is_paused:
            self.start_time = time.time()
            self.is_paused = False
            self.pause_reason = ""
            self.last_status = "RESUMED_ACTIVE"

    def update_metrics(
        self,
        evaluated_inc: int = 0,
        active: Optional[int] = None,
        pruned_inc: int = 0,
        tunneled_inc: int = 0,
        status: Optional[str] = None,
        confidence: Optional[float] = None
    ):
        self.total_evaluated += evaluated_inc
        if active is not None:
            self.active_branches = active
        self.pruned_branches += pruned_inc
        self.tunneled_branches += tunneled_inc
        if status:
            self.last_status = status
        if confidence is not None:
            self.best_confidence = max(self.best_confidence, confidence)

    def render_hud(self, stream=sys.stdout):
        """Renders live terminal dashboard."""
        uptime = self.get_uptime_formatted()
        status_color = "\033[92m" if not self.is_paused else "\033[93m"
        reset_color = "\033[0m"
        bold = "\033[1m"
        cyan = "\033[96m"
        magenta = "\033[95m"

        # Check if stream is interactive terminal
        is_tty = hasattr(stream, "isatty") and stream.isatty()
        
        hud = [
            f"{cyan}╔═══════════════════════════════════════════════════════════════════════════╗{reset_color}",
            f"{cyan}║{reset_color} {bold}🌌 QUANTUM AGENT CORE - AUTONOMOUS SUPERPOSITION ENGINE{reset_color}                {cyan}║{reset_color}",
            f"{cyan}╠═══════════════════════════════════════════════════════════════════════════╣{reset_color}",
            f"{cyan}║{reset_color} 🎯 Target/Task      : {self.target[:48]:<48} {cyan}║{reset_color}",
            f"{cyan}║{reset_color} ⏱️  Continuous Uptime: {bold}{uptime:<20}{reset_color} ⚡ Intensity: {magenta}{self.intensity:<14}{reset_color} {cyan}║{reset_color}",
            f"{cyan}║{reset_color} 🤖 Active Provider  : {self.provider:<20} 🏆 Top Confidence: {self.best_confidence*100:>5.1f}%  {cyan}║{reset_color}",
            f"{cyan}╠═══════════════════════════════════════════════════════════════════════════╣{reset_color}",
            f"{cyan}║{reset_color} 📊 Possibilities Evaluated : {bold}{self.total_evaluated:<12,}{reset_color}                            {cyan}║{reset_color}",
            f"{cyan}║{reset_color} 🌀 In-Flight Superposition : {self.active_branches:<12,} 🪓 Pruned Branches: {self.pruned_branches:<8,} {cyan}║{reset_color}",
            f"{cyan}║{reset_color} 🚇 Quantum Tunnel Leaps    : {self.tunneled_branches:<12,}                                {cyan}║{reset_color}",
            f"{cyan}╠═══════════════════════════════════════════════════════════════════════════╣{reset_color}",
            f"{cyan}║{reset_color} 🔔 Live Status: {status_color}{self.last_status[:52]:<52}{reset_color} {cyan}║{reset_color}",
            f"{cyan}╚═══════════════════════════════════════════════════════════════════════════╝{reset_color}",
        ]

        output_str = "\n".join(hud)
        if is_tty:
            # Clear screen and print
            print(f"\033[H\033[J{output_str}", file=stream, flush=True)
        else:
            print(output_str, file=stream, flush=True)

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "intensity": self.intensity,
            "provider": self.provider,
            "uptime_seconds": self.get_elapsed_seconds(),
            "uptime_formatted": self.get_uptime_formatted(),
            "total_evaluated": self.total_evaluated,
            "active_branches": self.active_branches,
            "pruned_branches": self.pruned_branches,
            "tunneled_branches": self.tunneled_branches,
            "best_confidence": self.best_confidence,
            "status": self.last_status,
            "is_paused": self.is_paused,
            "pause_reason": self.pause_reason
        }
