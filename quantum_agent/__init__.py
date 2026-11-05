"""
Quantum Agent - Autonomous Quantum-Inspired Multi-Model Agent Framework
"""

__version__ = "1.0.0"
__author__ = "Quantum Agent Open Source Contributors"

from quantum_agent.core.superposition import SuperpositionEngine
from quantum_agent.core.interference import InterferenceEngine
from quantum_agent.core.tunneling import TunnelingEngine
from quantum_agent.core.convergence import ConvergenceChecker
from quantum_agent.engine.scheduler import QuantumScheduler
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.engine.telemetry import LiveTelemetry
from quantum_agent.providers.universal import UniversalAIProvider

__all__ = [
    "SuperpositionEngine",
    "InterferenceEngine",
    "TunnelingEngine",
    "ConvergenceChecker",
    "QuantumScheduler",
    "QuantumStateDB",
    "LiveTelemetry",
    "UniversalAIProvider",
]
