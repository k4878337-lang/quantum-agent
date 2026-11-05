import readline from 'readline';
import { ProviderRegistry, ProviderType } from '../providers/registry.js';

export function askHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(query);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export async function interactiveSetup(registry: ProviderRegistry): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Quantum Agent — First-time Setup       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (registry.getEnabled().length > 0) {
    const skip = await ask(
      `Already ${registry.getEnabled().length} provider(s). Add another? (y/n): `
    );
    if (skip.toLowerCase() !== 'y') return;
  }

  const types: Record<string, ProviderType> = {
    '1': 'openai', '2': 'claude', '3': 'gemini',
    '4': 'ollama', '5': 'deepseek', '6': 'custom',
  };

  while (true) {
    console.log('\n  1) openai   2) claude   3) gemini');
    console.log('  4) ollama   5) deepseek 6) custom   0) done\n');
    const choice = await ask('Choose: ');
    if (choice === '0') break;
    const type = types[choice];
    if (!type) {
      console.log('Invalid.');
      continue;
    }

    const name = (await ask('Display name: ')) || `${type}-1`;
    let apiKey = '';
    let baseUrl = '';
    if (type !== 'ollama') apiKey = await askHidden(`API key: `);
    if (type === 'custom' || type === 'ollama') {
      baseUrl = (await ask('Base URL: ')) || 'http://localhost:11434';
    }
    const priorityStr = (await ask('Priority (1=highest, default 10): ')) || '10';

    const id = `${type}-${name.toLowerCase().replace(/\s+/g, '-')}`;
    registry.add({
      id, type, name,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      model: '',
      enabled: true,
      priority: parseInt(priorityStr, 10) || 10,
      addedAt: new Date().toISOString(),
    });
    console.log(`✅ Added: ${id}\n`);
  }
}
