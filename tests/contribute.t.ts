import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import {
  airdrop,
  createCampaign,
  getContributionPda,
  getVaultPda,
} from "./helpers";

describe("Contribute", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  it("Contributes SOL and initialises the contribution account", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const campaignPda = await createCampaign(program, creator);
    const vaultPda = getVaultPda(program.programId, campaignPda);
    const contributionPda = getContributionPda(program.programId, campaignPda, contributor.publicKey);
    const amount = new anchor.BN(1_000_000_000); // 1 SOL

    await program.methods
      .contribute(amount)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Campaign raised amount must equal the contribution.
    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok((campaign.raised as anchor.BN).eq(amount));

    // Contribution account must be initialised with correct fields.
    const contribution = await program.account.contribution.fetch(contributionPda);
    assert.ok(contribution.contributor.equals(contributor.publicKey));
    assert.ok(contribution.campaign.equals(campaignPda));
    assert.ok((contribution.amount as anchor.BN).eq(amount));

    // Vault must hold exactly the contributed lamports.
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, amount.toNumber());
  });

  it("Accumulates multiple contributions from the same contributor", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const campaignPda = await createCampaign(program, creator);
    const vaultPda = getVaultPda(program.programId, campaignPda);
    const contributionPda = getContributionPda(program.programId, campaignPda, contributor.publicKey);

    const firstAmount = new anchor.BN(1_000_000_000);
    const secondAmount = new anchor.BN(500_000_000);
    const totalAmount = firstAmount.add(secondAmount);

    await program.methods
      .contribute(firstAmount)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    await program.methods
      .contribute(secondAmount)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Contribution account must accumulate both amounts.
    const contribution = await program.account.contribution.fetch(contributionPda);
    assert.ok((contribution.amount as anchor.BN).eq(totalAmount));

    // Campaign raised must be the sum.
    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok((campaign.raised as anchor.BN).eq(totalAmount));

    // Vault must hold the combined lamports.
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, totalAmount.toNumber());
  });

  it("Multiple contributors each get their own contribution account", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributorA = anchor.web3.Keypair.generate();
    const contributorB = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributorA.publicKey);
    await airdrop(provider.connection, contributorB.publicKey);

    const campaignPda = await createCampaign(program, creator);
    const vaultPda = getVaultPda(program.programId, campaignPda);

    const amountA = new anchor.BN(1_000_000_000);
    const amountB = new anchor.BN(2_000_000_000);

    await program.methods
      .contribute(amountA)
      .accounts({ campaign: campaignPda, contributor: contributorA.publicKey })
      .signers([contributorA])
      .rpc();

    await program.methods
      .contribute(amountB)
      .accounts({ campaign: campaignPda, contributor: contributorB.publicKey })
      .signers([contributorB])
      .rpc();

    // Each contributor has a separate contribution account.
    const contribA = await program.account.contribution.fetch(
      getContributionPda(program.programId, campaignPda, contributorA.publicKey)
    );
    const contribB = await program.account.contribution.fetch(
      getContributionPda(program.programId, campaignPda, contributorB.publicKey)
    );

    assert.ok((contribA.amount as anchor.BN).eq(amountA));
    assert.ok((contribB.amount as anchor.BN).eq(amountB));
    assert.ok(contribA.contributor.equals(contributorA.publicKey));
    assert.ok(contribB.contributor.equals(contributorB.publicKey));

    // Campaign raised must be the sum of all contributions.
    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok((campaign.raised as anchor.BN).eq(amountA.add(amountB)));

    // Vault holds combined lamports from both contributors.
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, amountA.add(amountB).toNumber());
  });

  it("Fails when amount is zero", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const campaignPda = await createCampaign(program, creator);

    try {
      await program.methods
        .contribute(new anchor.BN(0))
        .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
        .signers([contributor])
        .rpc();
      assert.fail("Expected transaction to fail with ZeroAmount error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "ZeroAmount");
      assert.strictEqual(err.error.errorCode.number, 6002);
    }
  });

  it("Fails when the campaign deadline has passed", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    // Create a campaign that expires in 2 seconds.
    const shortDeadline = new anchor.BN(Math.floor(Date.now() / 1000) + 2);
    const campaignPda = await createCampaign(program, creator, new anchor.BN(5_000_000_000), shortDeadline);

    // Wait until the deadline has clearly passed (validator clock can lag ~1s).
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      await program.methods
        .contribute(new anchor.BN(1_000_000_000))
        .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
        .signers([contributor])
        .rpc();
      assert.fail("Expected transaction to fail with CampaignEnded error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "CampaignEnded");
      assert.strictEqual(err.error.errorCode.number, 6003);
    }
  });
});
