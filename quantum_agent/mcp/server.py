"""
Model Context Protocol (MCP) Standard Server for Quantum Agent
Implements JSON-RPC 2.0 over standard I/O (stdio).
Compatible with Cursor, Claude Desktop, Antigravity, and Cline.
"""

import sys
import json
import logging
from typing import Dict, Any, Optional

from quantum_agent.mcp.tools import (
    get_mcp_tool_definitions,
    handle_quantum_init_task,
    handle_quantum_step,
    handle_quantum_system_info,
    handle_quantum_solve,
    handle_quantum_explore_branches,
    handle_quantum_tunnel,
    handle_quantum_session_status
)

# Configure logger to stderr so stdout remains dedicated to JSON-RPC messages
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [QuantumMCP] %(levelname)s: %(message)s"
)
logger = logging.getLogger("QuantumMCPServer")


class QuantumMCPServer:
    """
    Standard MCP JSON-RPC 2.0 Server over stdio.
    """

    PROTOCOL_VERSION = "2024-11-05"

    def __init__(self):
        self.tools = {
            "quantum_init_task": handle_quantum_init_task,
            "quantum_step": handle_quantum_step,
            "quantum_system_info": handle_quantum_system_info,
            "quantum_solve": handle_quantum_solve,
            "quantum_explore_branches": handle_quantum_explore_branches,
            "quantum_tunnel": handle_quantum_tunnel,
            "quantum_session_status": handle_quantum_session_status,
        }

    def run_stdio(self):
        """Main stdio loop reading JSON-RPC messages line by line."""
        logger.info("Quantum Agent MCP Server starting over stdio...")
        
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue

                request = json.loads(line)
                response = self.handle_request(request)
                if response is not None:
                    sys.stdout.write(json.dumps(response) + "\n")
                    sys.stdout.flush()
            except json.JSONDecodeError as jde:
                logger.error(f"Malformed JSON: {jde}")
                err_resp = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": "Parse error"}
                }
                sys.stdout.write(json.dumps(err_resp) + "\n")
                sys.stdout.flush()
            except Exception as e:
                logger.error(f"Unexpected server exception: {e}")

    def handle_request(self, req: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        req_id = req.get("id")
        method = req.get("method")
        params = req.get("params", {})

        # Handle notifications (no id)
        if req_id is None:
            logger.info(f"Received notification: {method}")
            return None

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": self.PROTOCOL_VERSION,
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "quantum-agent",
                        "version": "1.0.0"
                    }
                }
            }

        elif method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": {}}

        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": get_mcp_tool_definitions()
                }
            }

        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})

            if tool_name not in self.tools:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Tool '{tool_name}' not found."
                    }
                }

            handler = self.tools[tool_name]
            try:
                result_str = handler(arguments)
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {"type": "text", "text": result_str}
                        ],
                        "isError": False
                    }
                }
            except Exception as ex:
                logger.error(f"Error executing tool '{tool_name}': {ex}")
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {"type": "text", "text": f"Error executing tool: {str(ex)}"}
                        ],
                        "isError": True
                    }
                }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"Method '{method}' not implemented."
                }
            }


def main():
    server = QuantumMCPServer()
    server.run_stdio()


if __name__ == "__main__":
    main()
