import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach } from 'vitest';
import { vi } from 'vitest';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-test-'));
}

export function cleanTmpDir(dir: string) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

export function makeFetchResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
