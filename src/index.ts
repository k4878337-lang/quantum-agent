#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SystemBrain } from './brain/system-brain.js';

const brain = new SystemBrain();

const server = new McpServer({ name: 'quantum-agent', version: '1.2.0' });

server.registerTool(
  'quantum-reason',
  {
    description: 'Multi-provider reasoning with failover + quota-aware pause. Phase 3: returns status=candidate with verified=false for weak heuristic.',
    inputSchema: {
      question: z.string(),
      mode: z.enum(['fast', 'medium', 'high', 'unlimited']).default('medium'),
      preferred_provider: z.string().optional(),
      max_runtime_hours: z.number().optional().default(720),
    },
  },
  async ({ question, mode, preferred_provider, max_runtime_hours }) => {
    const result = await brain.run({
      question, mode,
      preferredProvider: preferred_provider,
      maxRuntimeHours: max_runtime_hours,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.registerTool(
  'list-providers',
  {
    description: 'List providers (API keys redacted).',
    inputSchema: {},
  },
  async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify(brain.registry.listSafe(), null, 2),  // ⭐ no keys
    }],
  })
);

server.registerTool(
  'brain-status',
  {
    description: 'Environment, quota, paused tasks.',
    inputSchema: {},
  },
  async () => {
    const ids = brain.registry.getActive().map((p) => p.id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          environment: brain.env,
          providers: brain.registry.listSafe(),
          quota: brain.quota.status(ids),
          pausedTasks: brain.resume.listPaused().length,
        }, null, 2),
      }],
    };
  }
);

async function main() {
  await brain.boot();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] quantum-agent ready');
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
