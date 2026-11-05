import readline from 'readline';
import { ProviderRegistry, ProviderType } from '../providers/registry.js';

export function askHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    (rl as any)._writeToOutput = () => {};
    rl.question('', (ans) => {
      process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
  });
}

export function ask(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export async function interactiveSetup(
  registry: ProviderRegistry
): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Quantum Agent — First-time Setup       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (registry.getEnabled().length > 0) {
    const skip = await ask(
      `Already ${registry.getEnabled().length} provider(s) configured. Add another? (y/n): `
    );
    if (skip.toLowerCase() !== 'y') return;
  }

  while (true) {
    console.log('\nAvailable provider types:');
    console.log('  1) openai    (ChatGPT)');
    console.log('  2) claude    (Anthropic)');
    console.log('  3) gemini    (Google)');
    console.log('  4) ollama    (local)');
    console.log('  5) custom    (OpenAI-compatible)');
    console.log('  0) done\n');

    const choice = await ask('Choose: ');
    if (choice === '0') break;

    let type: ProviderType;
    switch (choice) {
      case '1':
        type = 'openai';
        break;
      case '2':
        type = 'claude';
        break;
      case '3':
        type = 'gemini';
        break;
      case '4':
        type = 'ollama';
        break;
      case '5':
        type = 'custom';
        break;
      default:
        console.log('Invalid choice.');
        continue;
    }

    const name = (await ask(`Display name: `)) || `${type}-1`;
    let apiKey = '';
    let baseUrl = '';

    if (type !== 'ollama') {
      apiKey = await askHidden(`API key for ${type}: `);
    }
    if (type === 'custom' || type === 'ollama') {
      baseUrl =
        (await ask('Base URL (e.g. http://localhost:11434): ')) ||
        'http://localhost:11434';
    }

    const priorityStr = (await ask('Priority (1 = highest, default 10): ')) || '10';

    const id = `${type}-${name.toLowerCase().replace(/\s+/g, '-')}`;
    registry.add({
      id,
      type,
      name,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      model: '', // set on connect
      enabled: true,
      priority: parseInt(priorityStr, 10) || 10,
      addedAt: new Date().toISOString(),
    });

    console.log(`✅ Added: ${id} (run \`qa connect ${id}\` to pick model)\n`);
  }

  console.log('\n✅ Setup complete.\n');
}
