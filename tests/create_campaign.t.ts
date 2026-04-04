import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import {
  airdrop,
  getCampaignPda,
  getRegistryPda,
  nextCampaignId,
} from "./helpers";

describe("Campaign Creation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const registryPda = getRegistryPda(program.programId, provider.wallet.publicKey);

  it("Creates a campaign and assigns a sequential ID", async () => {
    const goal = new anchor.BN(1_000_000_000);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

    const expectedId = await nextCampaignId(program, provider.wallet.publicKey);
    const campaignPda = getCampaignPda(program.programId, provider.wallet.publicKey, expectedId);

    // campaign PDA must be passed explicitly: Anchor's resolver cannot chain
    // registry → registry.campaign_count → campaign PDA in a single pass.
    await program.methods
      .createCampaign("My First Campaign", "Raising funds for a great cause", goal, deadline)
      .accountsPartial({ creator: provider.wallet.publicKey, campaign: campaignPda })
      .rpc();

    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok((campaign.id as anchor.BN).eq(expectedId));
    assert.ok(campaign.creator.equals(provider.wallet.publicKey));
    assert.strictEqual(campaign.title, "My First Campaign");
    assert.strictEqual(campaign.description, "Raising funds for a great cause");
    assert.ok((campaign.goal as anchor.BN).eq(goal));
    assert.ok((campaign.raised as anchor.BN).eqn(0));
    assert.ok((campaign.deadline as anchor.BN).eq(deadline));
    assert.isFalse(campaign.claimed);

    // Registry counter must have incremented by 1.
    const registry = await program.account.campaignRegistry.fetch(registryPda);
    assert.ok((registry.campaignCount as anchor.BN).eq(expectedId.addn(1)));
  });

  it("Each creator gets their own sequential campaign ID starting from 0", async () => {
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);

    const creatorA = anchor.web3.Keypair.generate();
    const creatorB = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creatorA.publicKey);
    await airdrop(provider.connection, creatorB.publicKey);

    // Each creator has their own registry; both start at campaign ID 0.
    const idA = await nextCampaignId(program, creatorA.publicKey);
    await program.methods
      .createCampaign("Campaign A", "Description A", new anchor.BN(1_000_000), deadline)
      .accountsPartial({ creator: creatorA.publicKey, campaign: getCampaignPda(program.programId, creatorA.publicKey, idA) })
      .signers([creatorA])
      .rpc();

    const idB = await nextCampaignId(program, creatorB.publicKey);
    await program.methods
      .createCampaign("Campaign B", "Description B", new anchor.BN(2_000_000), deadline)
      .accountsPartial({ creator: creatorB.publicKey, campaign: getCampaignPda(program.programId, creatorB.publicKey, idB) })
      .signers([creatorB])
      .rpc();

    const campaignA = await program.account.campaign.fetch(getCampaignPda(program.programId, creatorA.publicKey, idA));
    const campaignB = await program.account.campaign.fetch(getCampaignPda(program.programId, creatorB.publicKey, idB));

    // IDs are per-creator: both start at 0 for first-time creators.
    assert.ok((campaignA.id as anchor.BN).eqn(0));
    assert.ok((campaignB.id as anchor.BN).eqn(0));
    assert.ok(campaignA.creator.equals(creatorA.publicKey));
    assert.ok(campaignB.creator.equals(creatorB.publicKey));
  });

  it("Fails when goal is zero", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const goal = new anchor.BN(0);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
    const campaignPda = getCampaignPda(program.programId, creator.publicKey, await nextCampaignId(program, creator.publicKey));

    try {
      await program.methods
        .createCampaign("Test", "Test description", goal, deadline)
        .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with ZeroGoal error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "ZeroGoal");
      assert.strictEqual(err.error.errorCode.number, 6000);
    }
  });

  it("Fails when deadline is in the past", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const goal = new anchor.BN(1_000_000_000);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) - 1);
    const campaignPda = getCampaignPda(program.programId, creator.publicKey, await nextCampaignId(program, creator.publicKey));

    try {
      await program.methods
        .createCampaign("Test", "Test description", goal, deadline)
        .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineInPast error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineInPast");
      assert.strictEqual(err.error.errorCode.number, 6001);
    }
  });

  it("Fails when title exceeds 50 characters", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const campaignPda = getCampaignPda(program.programId, creator.publicKey, await nextCampaignId(program, creator.publicKey));
    const longTitle = "A".repeat(51);

    try {
      await program.methods
        .createCampaign(longTitle, "Valid description", new anchor.BN(1_000_000_000), new anchor.BN(Math.floor(Date.now() / 1000) + 3600))
        .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with TitleTooLong error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "TitleTooLong");
      assert.strictEqual(err.error.errorCode.number, 6011);
    }
  });

  it("Fails when description exceeds 200 characters", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const campaignPda = getCampaignPda(program.programId, creator.publicKey, await nextCampaignId(program, creator.publicKey));
    const longDescription = "A".repeat(201);

    try {
      await program.methods
        .createCampaign("Valid title", longDescription, new anchor.BN(1_000_000_000), new anchor.BN(Math.floor(Date.now() / 1000) + 3600))
        .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with DescTooLong error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DescTooLong");
      assert.strictEqual(err.error.errorCode.number, 6012);
    }
  });

  it("Fails when deadline equals current timestamp", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const goal = new anchor.BN(1_000_000_000);
    // Use "now - 2" instead of exact "now": the test validator's clock.unix_timestamp
    // can lag JS wall time by ~1s, so "now" may still be > validator clock and pass
    // the deadline check. Subtracting 2s guarantees it falls behind the validator clock.
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) - 2);
    const campaignPda = getCampaignPda(program.programId, creator.publicKey, await nextCampaignId(program, creator.publicKey));

    try {
      await program.methods
        .createCampaign("Test", "Test description", goal, deadline)
        .accountsPartial({ creator: creator.publicKey, campaign: campaignPda })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineInPast error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineInPast");
      assert.strictEqual(err.error.errorCode.number, 6001);
    }
  });
});
