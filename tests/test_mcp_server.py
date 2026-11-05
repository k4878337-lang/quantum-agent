"""
Tests for Quantum Agent MCP Server JSON-RPC 2.0 Compliance
"""

import unittest
from quantum_agent.mcp.server import QuantumMCPServer


class TestMCPServer(unittest.TestCase):

    def setUp(self):
        self.server = QuantumMCPServer()

    def test_mcp_initialize(self):
        resp = self.server.handle_request({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        })
        self.assertEqual(resp["id"], 1)
        self.assertIn("capabilities", resp["result"])
        self.assertIn("tools", resp["result"]["capabilities"])
        self.assertEqual(resp["result"]["serverInfo"]["name"], "quantum-agent")

    def test_mcp_tools_list(self):
        resp = self.server.handle_request({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        })
        tools = resp["result"]["tools"]
        tool_names = [t["name"] for t in tools]
        self.assertIn("quantum_solve", tool_names)
        self.assertIn("quantum_explore_branches", tool_names)
        self.assertIn("quantum_tunnel", tool_names)

    def test_mcp_tools_call_explore(self):
        resp = self.server.handle_request({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "quantum_explore_branches",
                "arguments": {
                    "problem": "Distributed caching inconsistency under high load",
                    "intensity": "FAST"
                }
            }
        })
        self.assertFalse(resp["result"]["isError"])
        self.assertIn("orthogonal_basis_states", resp["result"]["content"][0]["text"])


    def test_host_ai_control_flow(self):
        import json
        # 1. Host AI initializes task
        init_resp = self.server.handle_request({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "quantum_init_task",
                "arguments": {
                    "target": "Optimize Redis cache invalidation protocol",
                    "intensity": "FAST"
                }
            }
        })
        self.assertFalse(init_resp["result"]["isError"])
        init_data = json.loads(init_resp["result"]["content"][0]["text"])
        self.assertEqual(init_data["mode"], "HOST_AI_CONTROLLED")
        session_id = init_data["session_id"]
        first_state = init_data["initial_basis_states"][0]

        # 2. Host AI steps and evaluates the branch directly
        step_resp = self.server.handle_request({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {
                "name": "quantum_step",
                "arguments": {
                    "session_id": session_id,
                    "state_id": first_state["state_id"],
                    "evaluation_score": 0.85,
                    "is_exact_solution": False,
                    "reasoning": "High-confidence structural approach, expanding concurrency branch.",
                    "child_branches": [
                        {"hypothesis": "Epoll event loop pipeline", "action_plan": "Benchmark latency"}
                    ]
                }
            }
        })
        self.assertFalse(step_resp["result"]["isError"])
        step_data = json.loads(step_resp["result"]["content"][0]["text"])
        self.assertEqual(step_data["session_id"], session_id)
        self.assertEqual(step_data["children_spawned"], 1)


if __name__ == "__main__":
    unittest.main()
