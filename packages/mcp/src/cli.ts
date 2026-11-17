#!/usr/bin/env node
// Starts the Gavelock MCP server on stdio. Environment: GAVELOCK_RPC_URL (optional, one X Layer node).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createReader } from './reader.ts';
import { createServer } from './server.ts';

const rpc = process.env.GAVELOCK_RPC_URL;
const server = createServer(createReader(rpc ? { rpcUrls: [rpc] } : {}));
await server.connect(new StdioServerTransport());
