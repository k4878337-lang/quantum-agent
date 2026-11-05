"""
Quantum Agent Command-Line Interface (CLI)
Provides commands for running autonomous execution, launching MCP server, and inspecting sessions.
"""

import sys
import os
import argparse
import json
from quantum_agent.engine.scheduler import QuantumScheduler
from quantum_agent.engine.persistence import QuantumStateDB
from quantum_agent.providers.universal import UniversalAIProvider
from quantum_agent.mcp.server import QuantumMCPServer


def main():
    parser = argparse.ArgumentParser(
        prog="quantum-agent",
        description="🌌 Quantum Agent: Autonomous Quantum-Inspired Multi-Model Agent Framework"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Command: run
    run_parser = subparsers.add_parser("run", help="Run Quantum Agent on a target task")
    run_parser.add_argument(
        "--target", "-t",
        required=True,
        help="Target problem, code, app architecture, or diagnostic objective"
    )
    run_parser.add_argument(
        "--intensity", "-i",
        choices=["FAST", "MEDIUM", "HIGH"],
        default="HIGH",
        help="Search intensity (default: HIGH / Unbounded)"
    )
    run_parser.add_argument(
        "--provider", "-p",
        choices=["gemini", "openai", "anthropic", "deepseek", "groq", "openrouter", "ollama", "local", "simulation"],
        help="AI provider adapter (auto-detected from environment if omitted)"
    )
    run_parser.add_argument(
        "--model", "-m",
        help="Specific AI model name to execute with"
    )
    run_parser.add_argument(
        "--api-key", "-k",
        help="API Key for the chosen provider (defaults to environment variables)"
    )
    run_parser.add_argument(
        "--base-url", "-u",
        help="Base URL for local/Ollama or OpenAI-compatible custom servers"
    )
    run_parser.add_argument(
        "--session", "-s",
        help="Session ID to create or resume"
    )
    run_parser.add_argument(
        "--db",
        default="quantum_agent_memory.db",
        help="SQLite database path for state checkpointing"
    )

    # Command: mcp
    mcp_parser = subparsers.add_parser("mcp", help="Launch Model Context Protocol (MCP) server over stdio")

    # Command: status
    status_parser = subparsers.add_parser("status", help="Inspect active and past sessions in the memory database")
    status_parser.add_argument(
        "--db",
        default="quantum_agent_memory.db",
        help="SQLite database path to query"
    )
    status_parser.add_argument(
        "--session", "-s",
        help="Specific session ID to view details for"
    )

    # Command: providers
    prov_parser = subparsers.add_parser("providers", help="Check detected AI providers and active API keys")

    args = parser.parse_args()

    if args.command == "run":
        print(f"[*] Initializing Quantum Agent on: {args.target}")
        scheduler = QuantumScheduler(
            target=args.target,
            session_id=args.session,
            intensity=args.intensity,
            provider_name=args.provider,
            model_name=args.model,
            api_key=args.api_key,
            base_url=args.base_url,
            db_path=args.db
        )
        result = scheduler.run()
        print("\n" + "=" * 65)
        print("🏆 FINAL QUANTUM AGENT RESULT:")
        print(json.dumps(result, indent=2))
        print("=" * 65)

    elif args.command == "mcp":
        server = QuantumMCPServer()
        server.run_stdio()

    elif args.command == "status":
        db = QuantumStateDB(args.db)
        sessions = db.list_all_sessions()
        if not sessions:
            print("[i] No sessions found in database.")
            return

        if args.session:
            sess = next((s for s in sessions if s["session_id"] == args.session), None)
            if not sess:
                print(f"[!] Session '{args.session}' not found.")
                return
            best = db.get_best_solution(args.session)
            active = db.count_active_states(args.session)
            print(f"Session ID       : {sess['session_id']}")
            print(f"Target           : {sess['target']}")
            print(f"Status           : {sess['status']}")
            print(f"Uptime           : {sess['accumulated_uptime']:.1f}s")
            print(f"Evaluated        : {sess['total_evaluated']}")
            print(f"Active States    : {active}")
            if best:
                print(f"Winning Solution : {best.get('solution_code')}")
        else:
            print("=" * 75)
            print(f"{'SESSION ID':<18} {'STATUS':<12} {'EVALUATED':<12} {'TARGET':<30}")
            print("-" * 75)
            for s in sessions:
                print(f"{s['session_id']:<18} {s['status']:<12} {s['total_evaluated']:<12} {s['target'][:28]:<30}")
            print("=" * 75)

    elif args.command == "providers":
        provider = UniversalAIProvider()
        print("=" * 60)
        print("🤖 QUANTUM AGENT - DETECTED AI PROVIDERS & KEYS")
        print("=" * 60)
        env_keys = [
            ("Google Gemini", "GEMINI_API_KEY", os.getenv("GEMINI_API_KEY")),
            ("OpenAI", "OPENAI_API_KEY", os.getenv("OPENAI_API_KEY")),
            ("Anthropic Claude", "ANTHROPIC_API_KEY", os.getenv("ANTHROPIC_API_KEY")),
            ("DeepSeek", "DEEPSEEK_API_KEY", os.getenv("DEEPSEEK_API_KEY")),
            ("Groq", "GROQ_API_KEY", os.getenv("GROQ_API_KEY")),
            ("OpenRouter", "OPENROUTER_API_KEY", os.getenv("OPENROUTER_API_KEY")),
            ("Ollama (Local)", "LOCAL / http://localhost:11434/v1", "No key needed"),
            ("Quantum Simulator", "Internal heuristic engine", "Always Available")
        ]
        for name, env_var, val in env_keys:
            status = "✅ ACTIVE" if val else "❌ Not Configured"
            masked = f"({val[:6]}...)" if val and len(val) > 10 else ""
            print(f"- {name:<20}: {status} {masked}")
        print("=" * 60)
        print(f"Current Auto-Selected Provider: {provider.get_provider_name()}")
        print("=" * 60)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
