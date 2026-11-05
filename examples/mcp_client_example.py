"""
Example: Interacting with Quantum Agent MCP Server using standard JSON-RPC 2.0
"""

import json
from quantum_agent.mcp.server import QuantumMCPServer

def main():
    server = QuantumMCPServer()

    print("--- 1. Initialize MCP Server ---")
    init_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    }
    resp = server.handle_request(init_request)
    print(json.dumps(resp, indent=2))

    print("\n--- 2. List Available Quantum MCP Tools ---")
    tools_request = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    }
    resp = server.handle_request(tools_request)
    print(json.dumps(resp, indent=2))

    print("\n--- 3. Call 'quantum_explore_branches' Tool ---")
    call_request = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "quantum_explore_branches",
            "arguments": {
                "problem": "Microservice architecture database synchronization latency bottleneck",
                "intensity": "MEDIUM"
            }
        }
    }
    resp = server.handle_request(call_request)
    print(json.dumps(resp, indent=2))

if __name__ == "__main__":
    main()
