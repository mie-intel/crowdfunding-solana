/**
 * Self-contained smoke test for the crowdfunding program on devnet.
 * Uses the main wallet as both creator and contributor — no airdrop needed.
 *
 * No env vars needed. Just run:
 *   pnpm smoke:devnet
 *
 * Prerequisites:
 *   - Program deployed on devnet (anchor deploy)
 *   - ~/.config/solana/id.json has enough SOL (get from https://faucet.solana.com)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import type { Crowdfunding } from "../target/types/crowdfunding";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL     = "https://api.devnet.solana.com";
const WALLET_PATH = path.join(os.homedir(), ".config/solana/id.json");
const IDL_PATH    = path.join(process.cwd(), "./target/idl/crowdfunding.json");

// ── Setup ─────────────────────────────────────────────────────────────────────

function loadWallet(keypairPath: string): anchor.web3.Keypair {
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

// ── PDA helpers ───────────────────────────────────────────────────────────────

function getRegistryPda(programId: anchor.web3.PublicKey) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    programId
  );
  return pda;
}

function getCampaignPda(programId: anchor.web3.PublicKey, id: BN) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), id.toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

function getContributionPda(
  programId: anchor.web3.PublicKey,
  campaignPda: anchor.web3.PublicKey,
  contributor: anchor.web3.PublicKey
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("contribution"), campaignPda.toBuffer(), contributor.toBuffer()],
    programId
  );
  return pda;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nextCampaignId(program: Program<Crowdfunding>): Promise<BN> {
  const registryPda = getRegistryPda(program.programId);
  try {
    const registry = await program.account.campaignRegistry.fetch(registryPda);
    return registry.campaignCount as BN;
  } catch {
    return new BN(0);
  }
}

function sol(lamports: BN | number): string {
  const n = typeof lamports === "number" ? lamports : lamports.toNumber();
  return `${(n / 1e9).toFixed(4)} SOL`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const payer = loadWallet(WALLET_PATH);
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new Program<Crowdfunding>(idl, provider);

  console.log("=".repeat(60));
  console.log("  Crowdfunding Smoke Test (devnet)");
  console.log("=".repeat(60));
  console.log(`Program : ${program.programId}`);
  console.log(`RPC     : ${RPC_URL}`);
  console.log(`Wallet  : ${payer.publicKey}`);

  // ── Balance check ────────────────────────────────────────────────────────

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance : ${sol(balance)}`);

  if (balance < 1_000_000_000) {
    throw new Error(
      `Insufficient balance (${sol(balance)}). Get devnet SOL at https://faucet.solana.com`
    );
  }
  console.log("");

  // ── 1. Create Campaign ───────────────────────────────────────────────────
  // Use payer as creator — no airdrop needed

  console.log("[ 1 ] create_campaign...");

  const goal = new BN(500_000_000); // 0.5 SOL (small for devnet testing)
  const deadline = new BN(Math.floor(Date.now() / 1000) + 3600); // +1 hour
  const campaignId = await nextCampaignId(program);
  const campaignPda = getCampaignPda(program.programId, campaignId);

  const createTx = await program.methods
    .createCampaign("Devnet Smoke Test", "Testing crowdfunding on devnet", goal, deadline)
    .accountsPartial({ creator: payer.publicKey, campaign: campaignPda })
    .rpc();

  const campaign = await program.account.campaign.fetch(campaignPda);
  console.log(`  Tx      : ${createTx}`);
  console.log(`  PDA     : ${campaignPda}`);
  console.log(`  Title   : ${campaign.title}`);
  console.log(`  Goal    : ${sol(campaign.goal as BN)}`);
  console.log(`  Raised  : ${sol(campaign.raised as BN)}`);
  console.log(`  Claimed : ${campaign.claimed}`);
  console.log("");

  // ── 2. Contribute ────────────────────────────────────────────────────────
  // Use payer as contributor too — same wallet, different role

  console.log("[ 2 ] contribute...");

  const amount = new BN(100_000_000); // 0.1 SOL
  const contributionPda = getContributionPda(program.programId, campaignPda, payer.publicKey);

  const contributeTx = await program.methods
    .contribute(amount)
    .accountsPartial({
      contributor: payer.publicKey,
      campaign: campaignPda,
      contribution: contributionPda,
    })
    .rpc();

  const campaignAfter = await program.account.campaign.fetch(campaignPda);
  const contributionAcc = await program.account.contribution.fetch(contributionPda);
  console.log(`  Tx              : ${contributeTx}`);
  console.log(`  Amount sent     : ${sol(amount)}`);
  console.log(`  Campaign raised : ${sol(campaignAfter.raised as BN)}`);
  console.log(`  Contribution    : ${sol(contributionAcc.amount as BN)}`);
  console.log("");

  // ── 3. Registry ──────────────────────────────────────────────────────────

  console.log("[ 3 ] Registry state...");

  const registry = await program.account.campaignRegistry.fetch(getRegistryPda(program.programId));
  console.log(`  Total campaigns : ${registry.campaignCount}`);
  console.log("");

  const balanceAfter = await connection.getBalance(payer.publicKey);
  console.log(`Wallet balance after : ${sol(balanceAfter)}`);
  console.log(`Total spent          : ${sol(balance - balanceAfter)}`);
  console.log("");

  console.log("=".repeat(60));
  console.log("  Smoke test passed!");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err.message ?? err);
  process.exit(1);
});
