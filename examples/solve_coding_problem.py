"""
Example: Solving a complex distributed algorithm challenge with Quantum Agent
"""

from quantum_agent.engine.scheduler import QuantumScheduler

def main():
    target_problem = (
        "Design a Byzantine Fault Tolerant (BFT) distributed consensus protocol "
        "in Python that handles 3f+1 nodes with zero network deadlocks."
    )

    print(f"[*] Starting Quantum Agent on target: {target_problem}\n")

    # Launch with FAST or MEDIUM intensity using simulation or active AI provider
    scheduler = QuantumScheduler(
        target=target_problem,
        intensity="FAST",
        hud_refresh_interval=0.5
    )

    result = scheduler.run()
    print("\n[✓] Convergence Achieved!")
    print(f"Session ID: {result.get('session_id')}")
    print(f"Uptime: {result.get('uptime')}")
    print(f"Total Branches Evaluated: {result.get('evaluated_branches')}")
    print(f"Solution:\n{result.get('solution')}")

if __name__ == "__main__":
    main()
