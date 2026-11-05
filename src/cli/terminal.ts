#!/usr/bin/env node
import { Command } from 'commander';
import { ProviderRegistry, ProviderType } from '../providers/registry.js';
import { ModelDiscovery, AvailableModel } from '../providers/discovery.js';
import { SystemBrain } from '../brain/system-brain.js';
import { ask, askHidden } from '../brain/setup.js';

const program = new Command();
const VALID_TYPES: ProviderType[] = ['openai', 'claude', 'gemini', 'ollama', 'deepseek', 'custom'];

program
  .name('qa')
  .description('Quantum Agent — Multi-Provider AI Controller')
  .version('1.2.0');

program
  .command('add')
  .description('Add a provider')
  .requiredOption('-t, --type <type>', VALID_TYPES.join('|'))
  .requiredOption('-n, --name <name>', 'Display name')
  .option('-u, --url <url>', 'Base URL (custom/ollama)')
  .option('-p, --priority <n>', 'Priority (1=highest)', '10')
  .option('--key-stdin', 'Read key from stdin', false)
  .action(async (opts) => {
    const type = opts.type as ProviderType;
    if (!VALID_TYPES.includes(type)) {
      console.error(`Invalid type. Valid: ${VALID_TYPES.join(', ')}`);
      process.exit(1);
    }

    const registry = new ProviderRegistry();
    let apiKey: string | undefined;
    if (type !== 'ollama') {
      if (opts.keyStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        apiKey = Buffer.concat(chunks).toString('utf-8').trim();
      } else {
        apiKey = await askHidden(`API key for ${type}: `);
      }
      if (!apiKey) {
        console.error('API key required.');
        process.exit(1);
      }
    }

    const id = `${type}-${opts.name.toLowerCase().replace(/\s+/g, '-')}`;
    registry.add({
      id, type, name: opts.name, apiKey, baseUrl: opts.url,
      model: '', enabled: true,
      priority: parseInt(opts.priority),
      addedAt: new Date().toISOString(),
    });
    console.log(`✅ Added: ${id}`);
    console.log(`   Next: qa connect ${id}`);
  });

program
  .command('models')
  .description('List models from all enabled providers')
  .option('-p, --provider <id>', 'Filter')
  .action(async (opts) => {
    const registry = new ProviderRegistry();
    const discovery = new ModelDiscovery();
    let providers = registry.getEnabled();
    if (opts.provider) providers = providers.filter((p) => p.id === opts.provider);
    if (providers.length === 0) {
      console.log('No enabled providers.');
      return;
    }
    const rows: any[] = [];
    for (const p of providers) {
      try {
        const models = await discovery.list(p);
        for (const m of models) {
          rows.push({
            Provider: p.id,
            Model: m.id,
            Name: m.name !== m.id ? m.name : '',
            Connected: p.model === m.id ? '✅' : '',
          });
        }
      } catch (err: any) {
        console.error(`❌ ${p.id}: ${err.message}`);
      }
    }
    if (rows.length === 0) {
      console.log('No models.');
      return;
    }
    console.table(rows);
  });

program
  .command('connect <providerId> [modelId]')
  .description('Connect provider to a model')
  .action(async (providerId, modelId) => {
    const registry = new ProviderRegistry();
    const discovery = new ModelDiscovery();
    const provider = registry.find(providerId);
    if (!provider) {
      console.error(`❌ Not found: ${providerId}`);
      process.exit(1);
    }
    console.log(`🔍 Fetching models from ${providerId}...`);
    let models: AvailableModel[];
    try {
      models = await discovery.list(provider);
    } catch (err: any) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
    if (models.length === 0) {
      console.error('No models.');
      process.exit(1);
    }
    if (modelId) {
      if (!models.find((m) => m.id === modelId)) {
        console.error(`❌ Model not available.`);
        models.forEach((m) => console.log(`  • ${m.id}`));
        process.exit(1);
      }
      registry.setModel(providerId, modelId);
      console.log(`✅ ${providerId} → ${modelId}`);
      return;
    }
    console.log(`\nModels for ${providerId}:`);
    models.forEach((m, i) => console.log(`  ${i + 1}) ${m.id}${m.name !== m.id ? ` — ${m.name}` : ''}`));
    const def = discovery.pickDefault(provider, models);
    const defIdx = models.findIndex((m) => m.id === def);
    const choice = await ask(`\nSelect (1-${models.length}, default ${defIdx + 1}): `);
    const idx = choice ? parseInt(choice) - 1 : defIdx;
    if (idx < 0 || idx >= models.length) {
      console.error('Invalid.');
      process.exit(1);
    }
    registry.setModel(providerId, models[idx].id);
    console.log(`✅ ${providerId} → ${models[idx].id}`);
  });

program
  .command('connect-all')
  .description('Auto-connect all providers with defaults')
  .action(async () => {
    const registry = new ProviderRegistry();
    const discovery = new ModelDiscovery();
    for (const p of registry.getEnabled()) {
      try {
        console.log(`🔍 ${p.id}...`);
        const models = await discovery.list(p);
        const def = discovery.pickDefault(p, models);
        if (!def) {
          console.log('  ⚠️  no models');
          continue;
        }
        registry.setModel(p.id, def);
        console.log(`  ✅ → ${def}`);
      } catch (err: any) {
        console.error(`  ❌ ${err.message}`);
      }
    }
  });

program
  .command('list')
  .description('List all providers (keys redacted)')
  .action(() => {
    const registry = new ProviderRegistry();
    const safe = registry.listSafe();
    if (safe.length === 0) {
      console.log('No providers.');
      return;
    }
    console.table(safe);
  });

program.command('remove <id>').action((id) => {
  const registry = new ProviderRegistry();
  if (registry.remove(id)) console.log(`🗑️  Removed: ${id}`);
  else console.log(`❌ Not found: ${id}`);
});

program.command('enable <id>').action((id) => {
  new ProviderRegistry().setEnabled(id, true);
  console.log(`✅ Enabled: ${id}`);
});

program.command('disable <id>').action((id) => {
  new ProviderRegistry().setEnabled(id, false);
  console.log(`❌ Disabled: ${id}`);
});

program
  .command('ask <prompt>')
  .description('Ask a provider (weak heuristic gate — status=candidate)')
  .option('-p, --provider <id>', 'Prefer provider')
  .action(async (prompt, opts) => {
    const brain = new SystemBrain();
    const result = await brain.run({
      question: prompt,
      preferredProvider: opts.provider,
      maxRuntimeHours: 1,
    });
    if (result.answer) {
      console.log(`\n🤖 [${result.providerUsed} / ${result.modelUsed}]`);
      console.log(`\n${result.answer}\n`);
      console.log(`⏱️  ${result.elapsedSeconds}s, ${result.rounds} round(s)`);
      console.log(`📋 status=${result.status} verified=${result.verified} (${result.verificationLevel})`);
      if (!result.verified) {
        console.log(`⚠️  NOT independently verified. Phase 4 will implement real verifier.`);
      }
    } else {
      console.error(`❌ ${result.status}: ${result.reason}`);
    }
  });

program
  .command('run <question>')
  .description('Full brain loop')
  .option('-m, --mode <mode>', 'fast|medium|high|unlimited', 'medium')
  .option('--hours <n>', 'max runtime hours', '720')
  .action(async (question, opts) => {
    const brain = new SystemBrain();
    const result = await brain.run({
      question,
      mode: opts.mode,
      maxRuntimeHours: parseInt(opts.hours),
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('status')
  .description('Environment, providers, quota, paused tasks')
  .action(() => {
    const brain = new SystemBrain();
    const active = brain.registry.getActive().map((p) => p.id);
    console.log('\n🌍', brain.env);
    console.log('\n📡 Providers:');
    console.table(brain.registry.listSafe());   // ⭐ never leaks keys
    console.log('\n📊 Quota:');
    console.table(brain.quota.status(active));
    console.log('\n⏸️  Paused:', brain.resume.listPaused().length);
  });

program
  .command('resume')
  .description('Resume all paused tasks')
  .action(async () => {
    const brain = new SystemBrain();
    const paused = brain.resume.listPaused();
    if (!paused.length) {
      console.log('No paused tasks.');
      return;
    }
    for (const cp of paused) {
      console.log(`▶️  ${cp.taskId}`);
      try {
        const r = await brain.run({
          question: cp.question,
          mode: cp.mode as any,
          maxRuntimeHours: cp.maxRuntimeHours,
          taskId: cp.taskId,
        });
        console.log(`  ${r.status} (${r.verificationLevel})`);
      } catch (err: any) {
        console.error(`  Failed: ${err.message}`);
      }
    }
  });

program.parse();
