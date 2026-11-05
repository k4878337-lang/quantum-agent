"""
Quantum Agent MCP Tools Definition & Handlers
Exposes Quantum Agent mechanisms as standard Model Context Protocol tools.
Supports both:
1. Host AI Direct Control Mode (Gemini, Claude, ChatGPT control the brain directly without external API keys).
2. Autonomous Terminal Solver Mode.
"""

import json
from typing import Dict, Any, List
from quantum_agent.core.superposition import SuperpositionEngine
from quantum_agent.core.tunneling import TunnelingEngine
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.engine.scheduler import QuantumScheduler
from quantum_agent.engine.system_manager import QuantumSystemManager, ExecutionMode


def get_mcp_tool_definitions() -> List[Dict[str, Any]]:
    """Returns the JSON schema definitions for all Quantum Agent MCP tools."""
    return [
        {
            "name": "quantum_init_task",
            "description": "HOST AI CONTROL: Initializes a quantum superposition task directly for the connected AI (Gemini, Claude, ChatGPT). Generates orthogonal basis states without requiring external API keys.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "The exact objective, coding problem, or target to solve."
                    },
                    "intensity": {
                        "type": "string",
                        "enum": ["FAST", "MEDIUM", "HIGH"],
                        "default": "HIGH",
                        "description": "Search intensity."
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Optional session ID to resume or assign."
                    }
                },
                "required": ["target"]
            }
        },
        {
            "name": "quantum_step",
            "description": "HOST AI CONTROL: The connected AI directly submits its evaluation for a quantum branch. Quantum Agent applies Grover amplitude amplification or destructive pruning, tests convergence, and returns the next priority branches.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Active session ID from quantum_init_task."
                    },
                    "state_id": {
                        "type": "integer",
                        "description": "The state_id of the branch being evaluated."
                    },
                    "evaluation_score": {
                        "type": "number",
                        "description": "Confidence score from 0.0 to 1.0."
                    },
                    "is_exact_solution": {
                        "type": "boolean",
                        "description": "True if this branch fully satisfies 100% of target constraints with verified solution."
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Crisp reasoning synthesis of this branch."
                    },
                    "solution_code_or_proof": {
                        "type": "string",
                        "description": "Working solution code or definitive proof if solved."
                    },
                    "child_branches": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "hypothesis": {"type": "string"},
                                "action_plan": {"type": "string"}
                            },
                            "required": ["hypothesis"]
                        },
                        "description": "Orthogonal sub-branches spawned from this state."
                    }
                },
                "required": ["session_id", "state_id", "evaluation_score", "is_exact_solution", "reasoning"]
            }
        },
        {
            "name": "quantum_system_info",
            "description": "Displays Quantum Agent operating mode (Host AI direct control vs Standalone Terminal mode) and active system parameters.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "quantum_solve",
            "description": "Autonomous solver: Solves complex coding, research, or diagnostic problems using superposition search and exact convergence verification.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "The exact problem, target code, or research objective to solve."
                    },
                    "intensity": {
                        "type": "string",
                        "enum": ["FAST", "MEDIUM", "HIGH"],
                        "default": "FAST",
                        "description": "Search intensity."
                    },
                    "provider": {
                        "type": "string",
                        "description": "Optional AI provider override."
                    },
                    "model": {
                        "type": "string",
                        "description": "Optional specific model name to use."
                    }
                },
                "required": ["target"]
            }
        },
        {
            "name": "quantum_explore_branches",
            "description": "Decomposes any complex problem into orthogonal quantum basis states (multi-dimensional parallel hypotheses).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "problem": {
                        "type": "string",
                        "description": "The problem or target system to analyze."
                    },
                    "intensity": {
                        "type": "string",
                        "enum": ["FAST", "MEDIUM", "HIGH"],
                        "default": "MEDIUM"
                    }
                },
                "required": ["problem"]
            }
        },
        {
            "name": "quantum_tunnel",
            "description": "Forces an out-of-the-box lateral quantum tunnel leap to escape local reasoning traps or defensive bottlenecks.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {
                        "type": "string",
                        "description": "The target problem."
                    },
                    "bottleneck": {
                        "type": "string",
                        "description": "The wall, error, or defensive barrier where conventional approaches failed."
                    }
                },
                "required": ["target", "bottleneck"]
            }
        },
        {
            "name": "quantum_session_status",
            "description": "Queries persistent status, continuous uptime, evaluated possibilities, and convergence state for a Quantum Agent session.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The unique session ID to inspect."
                    }
                },
                "required": ["session_id"]
            }
        }
    ]


# Handlers
def handle_quantum_init_task(arguments: Dict[str, Any]) -> str:
    target = arguments["target"]
    intensity = arguments.get("intensity", "HIGH")
    session_id = arguments.get("session_id")

    mgr = QuantumSystemManager(mode=ExecutionMode.HOST_AI_CONTROLLED)
    result = mgr.host_init_task(target=target, intensity=intensity, session_id=session_id)
    return json.dumps(result, indent=2)


def handle_quantum_step(arguments: Dict[str, Any]) -> str:
    mgr = QuantumSystemManager(mode=ExecutionMode.HOST_AI_CONTROLLED)
    result = mgr.host_step(
        session_id=arguments["session_id"],
        state_id=arguments["state_id"],
        evaluation_score=float(arguments["evaluation_score"]),
        is_exact_solution=bool(arguments["is_exact_solution"]),
        reasoning=arguments["reasoning"],
        solution_code_or_proof=arguments.get("solution_code_or_proof"),
        child_branches=arguments.get("child_branches")
    )
    return json.dumps(result, indent=2)


def handle_quantum_system_info(arguments: Dict[str, Any]) -> str:
    mgr = QuantumSystemManager(mode=ExecutionMode.HOST_AI_CONTROLLED)
    return json.dumps(mgr.get_system_status(), indent=2)


def handle_quantum_solve(arguments: Dict[str, Any]) -> str:
    target = arguments["target"]
    intensity = arguments.get("intensity", "FAST")
    provider = arguments.get("provider")
    model = arguments.get("model")

    scheduler = QuantumScheduler(
        target=target,
        intensity=intensity,
        provider_name=provider,
        model_name=model,
        hud_refresh_interval=0.5
    )
    result = scheduler.run()
    return json.dumps(result, indent=2)


def handle_quantum_explore_branches(arguments: Dict[str, Any]) -> str:
    problem = arguments["problem"]
    intensity = arguments.get("intensity", "MEDIUM")
    engine = SuperpositionEngine(intensity=intensity)
    states = engine.create_initial_basis_states(problem)
    return json.dumps({
        "problem": problem,
        "orthogonal_basis_states": states
    }, indent=2)


def handle_quantum_tunnel(arguments: Dict[str, Any]) -> str:
    target = arguments["target"]
    bottleneck = arguments["bottleneck"]
    engine = TunnelingEngine()
    
    stuck_state = {
        "state_id": 999,
        "hypothesis": f"Conventional attempt blocked at: {bottleneck}",
        "depth": 3
    }
    leap = engine.execute_tunnel_leap(target, stuck_state)
    return json.dumps({
        "target": target,
        "bottleneck": bottleneck,
        "tunneled_leap": leap
    }, indent=2)


def handle_quantum_session_status(arguments: Dict[str, Any]) -> str:
    session_id = arguments["session_id"]
    db = QuantumStateDB()
    sessions = db.list_all_sessions()
    
    target_session = next((s for s in sessions if s["session_id"] == session_id), None)
    if not target_session:
        return f"Error: Session '{session_id}' not found in database."

    best = db.get_best_solution(session_id)
    active = db.count_active_states(session_id)
    return json.dumps({
        "session": target_session,
        "active_states": active,
        "best_solution": best
    }, indent=2)
