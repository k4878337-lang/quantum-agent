"""
Quantum Superposition & Multi-Branch State Exploration Engine
Generates orthogonal hypotheses and expands possibilities in parallel.
"""

from typing import List, Dict, Any, Optional
import json


class SuperpositionEngine:
    """
    Decomposes tasks into multi-dimensional state spaces and manages
    branch expansion mimicking quantum superposition.
    """

    def __init__(self, intensity: str = "HIGH"):
        self.intensity = intensity.upper()
        self.config = self._get_intensity_config(self.intensity)

    def _get_intensity_config(self, intensity: str) -> dict:
        configs = {
            "FAST": {
                "branch_factor": 2,
                "max_depth": 4,
                "batch_size": 5,
                "description": "Fast heuristic exploration for quick diagnostics"
            },
            "MEDIUM": {
                "branch_factor": 4,
                "max_depth": 10,
                "batch_size": 15,
                "description": "Balanced deep search for coding and architectural problems"
            },
            "HIGH": {
                "branch_factor": 8,
                "max_depth": 999999, # Virtually unbounded
                "batch_size": 40,
                "description": "Exhaustive long-term quantum search across unlimited possibility space"
            }
        }
        return configs.get(intensity, configs["HIGH"])

    def create_initial_basis_states(self, target: str) -> List[Dict[str, Any]]:
        """
        Creates orthogonal quantum basis states (|0>, |1>, |+>, |->)
        covering diverse investigative perspectives.
        """
        basis_perspectives = [
            ("Structural Decomposition", "Deconstruct into fundamental mathematical and algorithmic components"),
            ("Adversarial Edge-Case Stress", "Target boundary conditions, concurrency race conditions, and fail-safes"),
            ("Invariant & Logic Inversion", "Test counter-intuitive hypotheses and inverse assumptions"),
            ("Optimized Synthesis Path", "Direct solution construction using canonical patterns and high-efficiency structures"),
        ]

        if self.intensity in ("MEDIUM", "HIGH"):
            basis_perspectives.extend([
                ("Lateral Analogical Mapping", "Translate problem into analogous domains (compilers, distributed consensus, graphs)"),
                ("Heuristic Deep Search", "Probe high-complexity state spaces with continuous branch derivation"),
                ("Formal Constraint Relaxation", "Temporarily relax non-critical constraints to uncover non-obvious avenues"),
                ("Exhaustive Parameter Permutation", "Systematically permute variable boundaries and input spaces")
            ])

        states = []
        for title, perspective in basis_perspectives:
            hypothesis = f"[{title}] Focus: {perspective}. Target: {target}"
            states.append({
                "hypothesis": hypothesis,
                "depth": 1,
                "reasoning": f"Initial basis state instantiated under {title} dimension.",
                "score": 0.5
            })
        return states

    def generate_expansion_prompt(self, target: str, current_state: Dict[str, Any]) -> str:
        """
        Crafts high-leverage prompts forcing the LLM to branch out into
        novel sub-possibilities without circular reasoning.
        """
        bf = self.config["branch_factor"]
        return f"""You are the Superposition Core of a Quantum-Inspired Autonomous Agent.
TARGET / OBJECTIVE: {target}
CURRENT INVESTIGATION BRANCH (Depth {current_state.get('depth', 1)}):
Hypothesis: {current_state.get('hypothesis')}
Previous Reasoning: {current_state.get('reasoning', 'None')}

TASK:
Explore this hypothesis to the deepest logical conclusion.
Generate {bf} distinct, mutually-orthogonal child branches/sub-possibilities.
Each branch must propose a concrete test, code snippet, or investigative angle.

Return strictly a JSON object with this exact structure:
{{
  "evaluation_score": 0.0 to 1.0 (how promising is the current branch),
  "is_exact_solution": true or false,
  "solution_code_or_proof": "Concrete working code or definitive proof if solved, else null",
  "reasoning_summary": "Crisp 1-2 line synthesis of current state",
  "child_branches": [
    {{
      "hypothesis": "Concrete orthogonal sub-hypothesis 1",
      "action_plan": "Specific action to verify this branch"
    }}
  ]
}}"""

    def parse_expansion_response(self, content: str) -> Dict[str, Any]:
        """Safely parses structured JSON output from LLM responses."""
        try:
            # Strip markdown code fences if present
            cleaned = content.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            elif cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            
            data = json.loads(cleaned)
            return {
                "score": float(data.get("evaluation_score", 0.5)),
                "is_exact_solution": bool(data.get("is_exact_solution", False)),
                "solution": data.get("solution_code_or_proof"),
                "reasoning": data.get("reasoning_summary", ""),
                "children": data.get("child_branches", [])
            }
        except Exception:
            # Fallback heuristic parser if raw text was returned
            has_solved = "100%" in content or "exact solution" in content.lower() or "solved: true" in content.lower()
            return {
                "score": 0.7 if has_solved else 0.4,
                "is_exact_solution": has_solved,
                "solution": content if has_solved else None,
                "reasoning": content[:200],
                "children": [
                    {"hypothesis": f"Derived extension: {content[:80]}", "action_plan": "Evaluate derived path"}
                ]
            }
