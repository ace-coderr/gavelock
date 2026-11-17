import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotDeployedError, type Reader } from './reader.ts';
import { getRuleTruthTable, getSupplierPassport, getTender, listTenders, verifyAward } from './tools.ts';

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function answer(work: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    const text = error instanceof NotDeployedError ? error.message : `Could not read X Layer: ${(error as Error).message.split('\n')[0]}`;
    return { content: [{ type: 'text', text }], isError: true };
  }
}

/** The Gavelock MCP server. Every tool is read-only: nothing here can sign or send a transaction. */
export function createServer(reader: Reader): McpServer {
  const server = new McpServer({ name: 'gavelock', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

  server.registerTool('list_tenders', { description: 'List Gavelock tenders and quote requests on X Layer, newest first.', inputSchema: { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(10) }, annotations: readOnly }, ({ offset, limit }) =>
    answer(() => listTenders(reader, offset, limit)),
  );
  server.registerTool('get_tender', { description: 'Everything on chain about one tender: terms, checklist, ladders, bids, challenges and the award.', inputSchema: { id: z.number().int().min(0) }, annotations: readOnly }, ({ id }) => answer(() => getTender(reader, BigInt(id))));
  server.registerTool('get_rule_truth_table', { description: 'Read every outcome of a scoring rule circuit from X Layer (2,048 inputs).', inputSchema: { circuit: z.number().int().min(1) }, annotations: readOnly }, ({ circuit }) => answer(() => getRuleTruthTable(reader, circuit)));
  server.registerTool('verify_award', { description: 'Re-derive a tender’s award independently from the chain’s opened bids, revealed panel scores and the rule circuit, and report any difference from what the contract stored.', inputSchema: { id: z.number().int().min(0) }, annotations: readOnly }, ({ id }) => answer(() => verifyAward(reader, BigInt(id))));
  server.registerTool('get_supplier_passport', { description: 'A bidder’s record across all tenders: bids, openings, disqualifications and awards.', inputSchema: { address: z.string() }, annotations: readOnly }, ({ address }) => answer(() => getSupplierPassport(reader, address)));
  return server;
}
