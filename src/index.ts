#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SystemBrain } from './brain/system-brain.js';

const brain = new SystemBrain();

const server = new McpServer({
  name: 'quantum-agent',
  version: '1.0.0',
});

// ─── quantum-reason ───
server.tool(
  'quantum-reason',
  'Multi-provider reasoning with adaptive possibility exploration, quota-aware failover, and auto-resume.',
  {
    question: z.string(),
    mode: z.enum(['fast', 'medium', 'high', 'unlimited']).default('medium'),
    preferred_provider: z.string().optional(),
    max_runtime_hours: z.number().optional().default(720),
  },
  async ({ question, mode, preferred_provider, max_runtime_hours }) => {
    const result = await brain.run({
      question,
      mode,
      preferredProvider: preferred_provider,
      maxRuntimeHours: max_runtime_hours,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── list-providers ───
server.tool(
  'list-providers',
  'Show all configured providers, their models, and connection status.',
  {},
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(brain.registry.list(), null, 2),
      },
    ],
  })
);

// ─── brain-status ───
server.tool(
  'brain-status',
  'Show environment, providers, quota, and paused tasks.',
  {},
  async () => {
    const ids = brain.registry.getActive().map((p) => p.id);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              environment: brain.env,
              providers: brain.registry.list(),
              quota: brain.quota.status(ids),
              pausedTasks: brain.resume.listPaused().length,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Boot + serve ───
async function main() {
  await brain.boot();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] quantum-agent ready on stdio');
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
