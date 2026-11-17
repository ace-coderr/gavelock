// A real round trip: start the server as a child process on stdio and talk to it with the SDK's client.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('stdio server', () => {
  it('lists exactly the five read-only tools and answers honestly while nothing is deployed', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))], env: { ...process.env, GAVELOCK_DEPLOYMENT: '' } as Record<string, string> });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['get_rule_truth_table', 'get_supplier_passport', 'get_tender', 'list_tenders', 'verify_award']);
      for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
      const result = (await client.callTool({ name: 'list_tenders', arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/not deployed/);
      const bad = (await client.callTool({ name: 'get_tender', arguments: { id: -1 } })) as { isError?: boolean };
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 60_000);
});
