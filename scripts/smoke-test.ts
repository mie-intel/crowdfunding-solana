/**
 * Self-contained smoke test for the crowdfunding program on localnet.
 *
 * No env vars needed. Just run:
 *   pnpm ts-node -p ./tsconfig.json scripts/smoke-test.ts
 *
 * Prerequisites:
 *   1. solana-test-validator --reset   (running in another terminal)
 *   2. anchor deploy
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import type { Crowdfunding } from "../target/types/crowdfunding";
import BN from "bn.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";


// ── Config (edit these if needed) ────────────────────────────────────────────

const RPC_URL    = "http://127.0.0.1:8899";
const WALLET_PATH = path.join(os.homedir(), ".config/solana/id.json");
const IDL_PATH   = path.join(process.cwd(), "./target/idl/crowdfunding.json");

console.log(WALLET_PATH, IDL_PATH);

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

// ── Network helpers ───────────────────────────────────────────────────────────

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: anchor.web3.PublicKey,
  lamports = 10_000_000_000
) {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
}

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
  // Load payer wallet and build provider manually — no env vars needed
  const payer = loadWallet(WALLET_PATH);
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new Program<Crowdfunding>(idl, provider);

  console.log("=".repeat(60));
  console.log("  Crowdfunding Smoke Test");
  console.log("=".repeat(60));
  console.log(`Program : ${program.programId}`);
  console.log(`RPC     : ${RPC_URL}`);
  console.log(`Payer   : ${payer.publicKey}`);
  console.log("");

  // ── 1. Setup wallets ────────────────────────────────────────────────────

  console.log("[ 1 ] Airdrop to creator & contributor...");

  const creator = anchor.web3.Keypair.generate();
  const contributor = anchor.web3.Keypair.generate();

  await airdrop(connection, creator.publicKey);
  await airdrop(connection, contributor.publicKey);

  console.log(`  Creator     : ${creator.publicKey}  (${sol(10_000_000_000)})`);
  console.log(`  Contributor : ${contributor.publicKey}  (${sol(10_000_000_000)})`);
  console.log("");

  // ── 2. Create Campaign ──────────────────────────────────────────────────

  console.log("[ 2 ] create_campaign...");

  const goal = new BN(2_000_000_000); // 2 SOL
  const deadline = new BN(Math.floor(Date.now() / 1000) + 3600); // +1 jam
  const campaignId = await nextCampaignId(program);
  const campaignPda = getCampaignPda(program.programId, campaignId);

  const createTx = await program.methods
    .createCampaign("Smoke Test Campaign", "Testing crowdfunding on localnet", goal, deadline)
    .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
    .signers([creator])
    .rpc();

  const campaign = await program.account.campaign.fetch(campaignPda);
  console.log(`  Tx      : ${createTx}`);
  console.log(`  PDA     : ${campaignPda}`);
  console.log(`  Title   : ${campaign.title}`);
  console.log(`  Desc    : ${campaign.description}`);
  console.log(`  Goal    : ${sol(campaign.goal as BN)}`);
  console.log(`  Raised  : ${sol(campaign.raised as BN)}`);
  console.log(`  Claimed : ${campaign.claimed}`);
  console.log("");

  // ── 3. Contribute ───────────────────────────────────────────────────────

  console.log("[ 3 ] contribute...");

  const amount = new BN(500_000_000); // 0.5 SOL
  const contributionPda = getContributionPda(program.programId, campaignPda, contributor.publicKey);

  const contributeTx = await program.methods
    .contribute(amount)
    .accountsPartial({
      contributor: contributor.publicKey,
      campaign: campaignPda,
      contribution: contributionPda,
    })
    .signers([contributor])
    .rpc();

  const campaignAfter = await program.account.campaign.fetch(campaignPda);
  const contributionAcc = await program.account.contribution.fetch(contributionPda);
  console.log(`  Tx              : ${contributeTx}`);
  console.log(`  Amount sent     : ${sol(amount)}`);
  console.log(`  Campaign raised : ${sol(campaignAfter.raised as BN)}`);
  console.log(`  Contribution    : ${sol(contributionAcc.amount as BN)}`);
  console.log("");

  // ── 4. Registry ─────────────────────────────────────────────────────────

  console.log("[ 4 ] Registry state...");

  const registry = await program.account.campaignRegistry.fetch(getRegistryPda(program.programId));
  console.log(`  Total campaigns : ${registry.campaignCount}`);
  console.log("");

  console.log("=".repeat(60));
  console.log("  Smoke test passed!");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err.message ?? err);
  process.exit(1);
});
