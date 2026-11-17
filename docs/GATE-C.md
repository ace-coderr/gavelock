# Gate C: DeWEB publishing (dry run only)

Prepared 17 November 2026. **Nothing has been published and nothing sent to mainnet.** The dry run
(`packages/contracts/scripts/deweb-dry.ts`, raw output in `packages/contracts/reports/deweb-dry-run.json`)
deploys the whole system on a fork of X Layer, then publishes the real web build there exactly as it would be
published on mainnet, reads every file back the way a gateway does, and checks every SHA-256.

## Result

| | |
|---|---|
| Files | 8 |
| Bundle size | 977,312 bytes (954 KiB) |
| Transactions | 48 (one `putFile` per file, then one `appendChunk` per further 24,000 bytes) |
| Name bound | `1.2.<processor number>.tape` (on the fork: `1.2.426.tape`); binding was free (`monthlyFee()` is 0) |
| Read back | 8 of 8 files returned with matching length and SHA-256 |

| Cost | OKB |
|---|---|
| Opening the site container (circuit #1's account), `opener.FEE()` | **0.08** |
| Binding the name | 0 |
| Gas for all 48 transactions: 220,859,683 gas at 0.02 gwei | 0.0044 |
| **Total** | **about 0.085 OKB** |

The container is opened for circuit #1, which the deploy wallet owns after the Gate B deployment, so no
extra tape-out is needed. The cost is paid once; the files cannot be edited afterwards except by the
container's holder.

## What the dry run does not prove

- It ran against a fork of X Layer's real TapeOut contracts, so the fee, the opener and the registry are
  real. It does not prove that TapeOut's own gateway (`tapekit.org`) will serve the site: that can only be
  checked after publishing.
- The site makes read-only calls to public X Layer and drand endpoints from the visitor's browser. It loads
  no script, style, font or image from another origin (the build is checked for this in CI), so it keeps
  TapeKit's "fully on chain" property apart from those data reads.
- The DeWEB copy cannot be updated for free: any later change to the site means paying gas for the changed
  files again (the container fee is not paid twice).

## To approve

1. Gate B first: the DeWEB copy needs the deployed contracts, because the site's records point at them.
2. The deploy wallet needs another **0.1 OKB** (0.085 plus margin).
3. I would then publish the final build and report the live name.
