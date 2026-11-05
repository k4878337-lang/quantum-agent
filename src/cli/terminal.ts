#!/usr/bin/env node
import { Command } from 'commander';
import { ProviderRegistry, ProviderType } from '../providers/registry.js';
import { ModelDiscovery, AvailableModel } from '../providers/discovery.js';
import { SystemBrain } from '../brain/system-brain.js';
import { ask, askHidden } from '../brain/setup.js';

const program = new Command();
const registry = new ProviderRegistry();
const discovery = new ModelDiscovery();

program
  .name('qa')
  .description('Quantum Agent — Multi-Provider AI Controller')
  .version('1.0.0');

// ═══════════════════════════════════════════════════
// qa add — Add a provider
// ═══════════════════════════════════════════════════
program
  .command('add')
  .description('Add an AI provider')
  .requiredOption('-t, --type <type>', 'openai | claude | gemini | ollama | custom')
  .requiredOption('-n, --name <name>', 'Display name')
  .option('-k, --key <key>', 'API key (prompt if omitted)')
  .option('-u, --url <url>', 'Base URL (for custom/ollama)')
  .option('-p, --priority <n>', 'Priority (1 = highest, default 10)', '10')
  .action(async (opts) => {
    const type = opts.type as ProviderType;
    if (!['openai', 'claude', 'gemini', 'ollama', 'custom'].includes(type)) {
      console.error(`Invalid type: ${type}`);
      process.exit(1);
    }

    let apiKey = opts.key;
    if (!apiKey && type !== 'ollama') {
      apiKey = await askHidden(`API key for ${type}: `);
    }

    const id = `${type}-${opts.name.toLowerCase().replace(/\s+/g, '-')}`;
    registry.add({
      id,
      type,
      name: opts.name,
      apiKey,
      baseUrl: opts.url,
      model: '',
      enabled: true,
      priority: parseInt(opts.priority, 10) || 10,
      addedAt: new Date().toISOString(),
    });

    console.log(`✅ Provider added: ${id}`);
    console.log(`   Next: qa connect ${id}   (fetch models + select)`);
  });

// ═══════════════════════════════════════════════════
// qa models — ⭐ List ALL models from ALL providers
// ═══════════════════════════════════════════════════
program
  .command('models')
  .description('List all available models from all enabled providers')
  .option('-p, --provider <id>', 'Filter by provider id')
  .action(async (opts) => {
    let providers = registry.getEnabled();
    if (opts.provider) {
      providers = providers.filter((p) => p.id === opts.provider);
    }
    if (providers.length === 0) {
      console.log('No enabled providers. Run `qa add` first.');
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
      console.log('No models found.');
      return;
    }
    console.table(rows);
    console.log(`\nTotal: ${rows.length} model(s) across ${providers.length} provider(s)`);
    console.log(`Connect one: qa connect <provider-id> <model-id>`);
    console.log(`Auto-connect all: qa connect-all`);
  });

// ═══════════════════════════════════════════════════
// qa connect — ⭐ Connect provider to specific model
// ═══════════════════════════════════════════════════
program
  .command('connect <providerId> [modelId]')
  .description('Connect provider to a model (interactive if model omitted)')
  .action(async (providerId, modelId) => {
    const provider = registry.find(providerId);
    if (!provider) {
      console.error(`❌ Provider not found: ${providerId}`);
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
      console.error('No models available.');
      process.exit(1);
    }

    if (modelId) {
      if (!models.find((m) => m.id === modelId)) {
        console.error(`❌ Model ${modelId} not available for ${providerId}`);
        console.log('Available models:');
        models.forEach((m) => console.log(`  • ${m.id}`));
        process.exit(1);
      }
      registry.setModel(providerId, modelId);
      console.log(`✅ Connected: ${providerId} → ${modelId}`);
      return;
    }

    // Interactive selection
    console.log(`\nAvailable models for ${providerId}:`);
    models.forEach((m, i) =>
      console.log(`  ${i + 1}) ${m.id}${m.name !== m.id ? ` — ${m.name}` : ''}`)
    );

    const defaultModel = discovery.pickDefault(provider, models);
    const defaultIdx = models.findIndex((m) => m.id === defaultModel);
    const safeDefaultIdx = defaultIdx >= 0 ? defaultIdx : 0;

    const choice = await ask(`\nSelect (1-${models.length}, default ${safeDefaultIdx + 1}): `);
    const idx = choice ? parseInt(choice, 10) - 1 : safeDefaultIdx;
    if (idx < 0 || idx >= models.length) {
      console.error('Invalid selection.');
      process.exit(1);
    }
    registry.setModel(providerId, models[idx].id);
    console.log(`✅ Connected: ${providerId} → ${models[idx].id}`);
  });

// ═══════════════════════════════════════════════════
// qa connect-all — ⭐ Auto-connect all providers
// ═══════════════════════════════════════════════════
program
  .command('connect-all')
  .description('Auto-connect every enabled provider with a sensible default model')
  .action(async () => {
    const providers = registry.getEnabled();
    if (providers.length === 0) {
      console.log('No enabled providers.');
      return;
    }

    for (const p of providers) {
      try {
        console.log(`🔍 ${p.id}...`);
        const models = await discovery.list(p);
        const defaultModel = discovery.pickDefault(p, models);
        if (!defaultModel) {
          console.log(`  ⚠️  No models available`);
          continue;
        }
        registry.setModel(p.id, defaultModel);
        console.log(`  ✅ → ${defaultModel}`);
      } catch (err: any) {
        console.error(`  ❌ ${err.message}`);
      }
    }
  });

// ═══════════════════════════════════════════════════
// qa list — Show all providers
// ═══════════════════════════════════════════════════
program
  .command('list')
  .description('List all configured providers')
  .action(() => {
    const providers = registry.list();
    if (providers.length === 0) {
      console.log('No providers. Run `qa add` first.');
      return;
    }
    console.table(
      providers.map((p) => ({
        id: p.id,
        type: p.type,
        model: p.model || '(not connected)',
        enabled: p.enabled ? '✅' : '❌',
        priority: p.priority,
      }))
    );
  });

// ═══════════════════════════════════════════════════
// qa remove
// ═══════════════════════════════════════════════════
program
  .command('remove <id>')
  .description('Remove a provider')
  .action((id) => {
    if (registry.remove(id)) console.log(`🗑️  Removed: ${id}`);
    else console.log(`❌ Not found: ${id}`);
  });

// ═══════════════════════════════════════════════════
// qa enable / disable
// ═══════════════════════════════════════════════════
program.command('enable <id>').action((id) => {
  registry.setEnabled(id, true);
  console.log(`✅ Enabled: ${id}`);
});

program.command('disable <id>').action((id) => {
  registry.setEnabled(id, false);
  console.log(`❌ Disabled: ${id}`);
});

// ═══════════════════════════════════════════════════
// qa ask — Simple question
// ═══════════════════════════════════════════════════
program
  .command('ask <prompt>')
  .description('Ask any connected provider (with fallback)')
  .option('-p, --provider <id>', 'Prefer specific provider')
  .action(async (prompt, opts) => {
    const brain = new SystemBrain();
    const result = await brain.run({
      question: prompt,
      preferredProvider: opts.provider,
      maxRuntimeHours: 1,
    });
    if (result.status === 'done' && result.answer) {
      console.log(`\n🤖 [${result.providerUsed} / ${result.modelUsed}]\n`);
      console.log(result.answer);
      console.log(`\n⏱️  ${result.elapsedSeconds}s, ${result.rounds} round(s)`);
    } else {
      console.error(`❌ ${result.status}: ${result.reason || 'unknown'}`);
    }
  });

// ═══════════════════════════════════════════════════
// qa run — Long-running task with full brain
// ═══════════════════════════════════════════════════
program
  .command('run <question>')
  .description('Run full brain loop (failover, quota wait, auto-resume)')
  .option('-m, --mode <mode>', 'fast|medium|high|unlimited', 'medium')
  .option('-h, --hours <n>', 'max runtime hours', '720')
  .option('--background', 'run detached', false)
  .action(async (question, opts) => {
    if (opts.background) {
      const { spawn } = await import('child_process');
      const child = spawn(
        process.execPath,
        [process.argv[1], 'run', question, '-m', opts.mode, '-h', opts.hours],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();
      console.log(`✅ Running in background. PID: ${child.pid}`);
      return;
    }

    const brain = new SystemBrain();
    const result = await brain.run({
      question,
      mode: opts.mode,
      maxRuntimeHours: parseInt(opts.hours, 10) || 720,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ═══════════════════════════════════════════════════
// qa status
// ═══════════════════════════════════════════════════
program
  .command('status')
  .description('Show environment, providers, quota, paused tasks')
  .action(() => {
    const brain = new SystemBrain();
    const ids = brain.registry.getActive().map((p) => p.id);

    console.log('\n🌍 Environment:', brain.env);
    console.log('\n📡 Providers:');
    console.table(
      brain.registry.list().map((p) => ({
        id: p.id,
        type: p.type,
        model: p.model || '—',
        enabled: p.enabled ? '✅' : '❌',
      }))
    );
    console.log('\n📊 Quota:');
    console.table(brain.quota.status(ids));
    console.log('\n⏸️  Paused tasks:', brain.resume.listPaused().length);
  });

// ═══════════════════════════════════════════════════
// qa resume
// ═══════════════════════════════════════════════════
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
      console.log(`▶️  Resuming ${cp.taskId}...`);
      brain
        .run({ question: cp.question, mode: cp.mode as any, taskId: cp.taskId })
        .catch((err) => console.error(`Failed: ${err.message}`));
    }
  });

program.parse();
