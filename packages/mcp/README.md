# @gavelock/mcp

A read-only [MCP](https://modelcontextprotocol.io) server for Gavelock. It reads X Layer directly and
has no wallet, no key and no way to send a transaction.

| Tool | What it returns |
|---|---|
| `list_tenders` | Tenders and quote requests, newest first. |
| `get_tender` | Terms, checklist, ladders, bids, challenges and the award of one tender. |
| `get_rule_truth_table` | Every outcome of a scoring rule circuit, read from the chain (2,048 inputs). |
| `verify_award` | Re-derives the award from the chain's opened bids, revealed panel scores and the rule circuit, and reports any difference from what the contract stored. |
| `get_supplier_passport` | A bidder's bids, openings, disqualifications and awards across all tenders. |

## Run

```
node packages/mcp/src/cli.ts
```

Node 24 or newer runs the TypeScript directly. Optional: `GAVELOCK_RPC_URL` to use one X Layer node.

Example client configuration:

```json
{ "mcpServers": { "gavelock": { "command": "node", "args": ["packages/mcp/src/cli.ts"] } } }
```

Until the Gavelock contracts are deployed to X Layer mainnet, every tool answers that nothing is deployed.
