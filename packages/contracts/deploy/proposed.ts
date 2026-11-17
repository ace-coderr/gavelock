// The parameters proposed to the owner at Gate B. Nothing is deployed until the owner approves these.
import { parseEther } from "viem";

export const PROPOSED = {
  /// 0.0007 OKB on top of TapeOut's 0.0013: a buyer taping out a custom rule pays 0.002 OKB in total.
  ruleFee: parseEther("0.0007"),
  /// A full tender costs 0.01 OKB. A Quick Quote is free. Bidding is free (it needs a refundable deposit).
  tenderFee: parseEther("0.01"),
  /// 100 million transistors: draining them with maximum-size rules would take 66,665 tape-outs (86 OKB in TapeOut fees alone).
  supply: 100_000_000n,
  name: "Gavelock",
  symbol: "GAVEL",
  story: "Tamper-proof tenders and quote requests. Every scoring rule is a circuit taped out on this processor, and an award is computed by calling it.",
} as const;
