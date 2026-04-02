import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../../target/types/crowdfunding";
import { getCampaignPda, getRegistryPda } from "./pda";

/**
 * Returns the ID that will be assigned to the next campaign.
 * Reads registry.campaign_count; returns 0 if the registry doesn't exist yet.
 */
export async function nextCampaignId(
  program: Program<Crowdfunding>
): Promise<anchor.BN> {
  const registryPda = getRegistryPda(program.programId);
  try {
    const registry = await program.account.campaignRegistry.fetch(registryPda);
    return registry.campaignCount as anchor.BN;
  } catch {
    return new anchor.BN(0);
  }
}

/**
 * Creates a campaign and returns its PDA.
 * Deadline defaults to 1 hour from now.
 */
export async function createCampaign(
  program: Program<Crowdfunding>,
  creator: anchor.web3.Keypair,
  goal = new anchor.BN(5_000_000_000),
  deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600)
): Promise<anchor.web3.PublicKey> {
  const id = await nextCampaignId(program);
  const campaignPda = getCampaignPda(program.programId, id);

  await program.methods
    .createCampaign(goal, deadline)
    .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
    .signers([creator])
    .rpc();

  return campaignPda;
}
