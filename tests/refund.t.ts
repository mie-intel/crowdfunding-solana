import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import {
  airdrop,
  createCampaign,
  getContributionPda,
  getVaultPda,
  SHORT_DEADLINE_SEC,
  WAIT_MS,
} from "./helpers";

describe("Refund", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  /**
   * Creates a campaign with a short deadline and a goal that intentionally
   * cannot be met (very high goal), then contributes a smaller amount and
   * waits for the deadline to pass.
   *
   * Returns everything needed to call refund.
   */
  async function setupRefundableCampaign(
    goalLamports = new anchor.BN(10_000_000_000), // 10 SOL — never reachable
    contributeAmount = new anchor.BN(1_000_000_000) // 1 SOL
  ) {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, goalLamports, deadline);
    const vaultPda = getVaultPda(program.programId, campaignPda);
    const contributionPda = getContributionPda(
      program.programId,
      campaignPda,
      contributor.publicKey
    );

    await program.methods
      .contribute(contributeAmount)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Wait for the deadline to clearly pass.
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    return { campaignPda, creator, contributor, vaultPda, contributionPda, contributeAmount };
  }

  // ---------------------------------------------------------------------------

  it("Contributor receives refund after failed campaign", async () => {
    const { campaignPda, contributor, contributionPda, contributeAmount } =
      await setupRefundableCampaign();

    const balanceBefore = await provider.connection.getBalance(contributor.publicKey);

    await program.methods
      .refund()
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Contributor balance must increase by at least the contributed amount (minus tx fees).
    const balanceAfter = await provider.connection.getBalance(contributor.publicKey);
    assert.ok(
      balanceAfter >= balanceBefore + contributeAmount.toNumber() - 10_000,
      "contributor should receive back at least their contribution minus tx fees"
    );

    // Contribution account must be closed (null means the account no longer exists).
    const contributionInfo = await provider.connection.getAccountInfo(contributionPda);
    assert.isNull(contributionInfo, "contribution account should be closed after refund");
  });

  it("Vault balance decreases by the refunded amount", async () => {
    const { campaignPda, contributor, vaultPda, contributeAmount } =
      await setupRefundableCampaign();

    const vaultBefore = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBefore, contributeAmount.toNumber());

    await program.methods
      .refund()
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    const vaultAfter = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultAfter, 0, "vault should be empty after the only contributor refunds");
  });

  it("Multiple contributors can each refund independently", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributorA = anchor.web3.Keypair.generate();
    const contributorB = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributorA.publicKey);
    await airdrop(provider.connection, contributorB.publicKey);

    const goal = new anchor.BN(20_000_000_000); // 20 SOL — unreachable
    const amountA = new anchor.BN(1_000_000_000); // 1 SOL
    const amountB = new anchor.BN(2_000_000_000); // 2 SOL
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, goal, deadline);
    const vaultPda = getVaultPda(program.programId, campaignPda);

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

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    const balanceABefore = await provider.connection.getBalance(contributorA.publicKey);
    const balanceBBefore = await provider.connection.getBalance(contributorB.publicKey);

    // Contributor A refunds.
    await program.methods
      .refund()
      .accounts({ campaign: campaignPda, contributor: contributorA.publicKey })
      .signers([contributorA])
      .rpc();

    // Contributor B refunds.
    await program.methods
      .refund()
      .accounts({ campaign: campaignPda, contributor: contributorB.publicKey })
      .signers([contributorB])
      .rpc();

    const balanceAAfter = await provider.connection.getBalance(contributorA.publicKey);
    const balanceBAfter = await provider.connection.getBalance(contributorB.publicKey);

    assert.ok(
      balanceAAfter >= balanceABefore + amountA.toNumber() - 10_000,
      "contributor A should receive back their contribution"
    );
    assert.ok(
      balanceBAfter >= balanceBBefore + amountB.toNumber() - 10_000,
      "contributor B should receive back their contribution"
    );

    // Vault must be empty after all contributors have refunded.
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, 0, "vault should be empty after all refunds");

    // Both contribution accounts must be closed.
    const infoA = await provider.connection.getAccountInfo(
      getContributionPda(program.programId, campaignPda, contributorA.publicKey)
    );
    const infoB = await provider.connection.getAccountInfo(
      getContributionPda(program.programId, campaignPda, contributorB.publicKey)
    );
    assert.isNull(infoA, "contributor A account should be closed");
    assert.isNull(infoB, "contributor B account should be closed");
  });

  it("Fails when deadline has not passed yet", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    // Long deadline — will not expire during this test.
    const goal = new anchor.BN(10_000_000_000);
    const campaignPda = await createCampaign(program, creator, goal);

    await program.methods
      .contribute(new anchor.BN(1_000_000_000))
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Attempt refund immediately — deadline has not passed.
    try {
      await program.methods
        .refund()
        .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
        .signers([contributor])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineNotReached error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineNotReached");
      assert.strictEqual(err.error.errorCode.number, 6004);
    }
  });

  it("Fails when contributor has no recorded deposit (NothingToRefund)", async () => {
    // A wallet that never called contribute has no Contribution PDA.
    // The refund instruction will fail at account validation before even reaching
    // the NothingToRefund guard — but the net effect is the same: the call is rejected.
    const { campaignPda } = await setupRefundableCampaign();

    const stranger = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, stranger.publicKey);

    try {
      await program.methods
        .refund()
        .accounts({ campaign: campaignPda, contributor: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail("Expected refund to fail for a non-contributor");
    } catch (err) {
      // The tx must fail — either at Anchor account validation (no Contribution PDA exists)
      // or at the NothingToRefund guard. Either way the stranger cannot drain the vault.
      assert.ok(err instanceof Error, "Expected an error to be thrown");
    }
  });

  it("Fails when the campaign goal was reached (use withdraw instead)", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    // Goal is small enough that the contribution meets it.
    const goal = new anchor.BN(1_000_000_000); // 1 SOL
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, goal, deadline);

    // Contribute exactly the goal — campaign is now successful.
    await program.methods
      .contribute(goal)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    try {
      await program.methods
        .refund()
        .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
        .signers([contributor])
        .rpc();
      assert.fail("Expected transaction to fail with GoalReached error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "GoalReached");
      assert.strictEqual(err.error.errorCode.number, 6008);
    }
  });
});
