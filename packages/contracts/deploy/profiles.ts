// Deployment profiles. Each is a complete, approved-by-name set of numbers; the owner chooses one at Gate B.
// "full" is the table in docs/GATE-B.md. "lean" is the cut-down variant in docs/GATE-B-LEAN.md.
import { parseEther } from "viem";

export type ProfileName = "full" | "lean";

export interface Profile {
  /// Starter rules taped out at deployment, by key. The others can be added later (scripts/add-rules.ts).
  rules: readonly string[];
  ruleFee: bigint;
  tenderFee: bigint;
  supply: bigint;
  name: string;
  symbol: string;
  story: string;
  demo: {
    /// Wallets that bid in the demo tenders. A Quick Quote needs three, so a profile with fewer skips it.
    bidders: number;
    panelMembers: number;
    /// OKB sent to each demo bidder: the 0.001 OKB deposit plus gas with a wide margin.
    bidderFundWei: bigint;
    /// OKB sent to each panel member: gas for one commit and one reveal, with a wide margin.
    panelFundWei: bigint;
    quickQuote: boolean;
  };
}

const common = {
  /// 0.0007 OKB on top of TapeOut's 0.0013: a custom rule costs a buyer 0.002 OKB in total.
  ruleFee: parseEther("0.0007"),
  /// Draining 100,000,000 transistors would take 66,665 maximum-size rules (86.7 OKB in TapeOut fees alone).
  supply: 100_000_000n,
  name: "Gavelock",
  symbol: "GAVEL",
  story: "Tamper-proof tenders and quote requests. Every scoring rule is a circuit taped out on this processor, and an award is computed by calling it.",
} as const;

export const PROFILES: Record<ProfileName, Profile> = {
  full: {
    ...common,
    rules: ["lowest-price", "price-60-quality-40", "quality-70-price-30", "fastest-delivery"],
    tenderFee: parseEther("0.01"),
    demo: { bidders: 3, panelMembers: 3, bidderFundWei: parseEther("0.003"), panelFundWei: parseEther("0.0005"), quickQuote: true },
  },
  lean: {
    ...common,
    rules: ["price-60-quality-40"],
    tenderFee: parseEther("0.001"),
    // Two bidders and three panel members at the smallest safe balances. With two bidders a Quick Quote cannot
    // reach its three-quote minimum, so the lean demo is one full tender.
    demo: { bidders: 2, panelMembers: 3, bidderFundWei: parseEther("0.0013"), panelFundWei: parseEther("0.0001"), quickQuote: false },
  },
};

export function profileFromEnv(env: NodeJS.ProcessEnv = process.env): { name: ProfileName; profile: Profile } {
  const name = (env.DEPLOY_PROFILE ?? "full") as ProfileName;
  if (!(name in PROFILES)) throw new Error(`DEPLOY_PROFILE must be "full" or "lean", not "${name}"`);
  return { name, profile: PROFILES[name] };
}
