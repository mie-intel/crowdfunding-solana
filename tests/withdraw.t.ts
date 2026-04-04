import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import { airdrop, createCampaign, getVaultPda, SHORT_DEADLINE_SEC, WAIT_MS } from "./helpers";

describe("Withdraw", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  /**
   * Creates a campaign with a short deadline, contributes to meet the goal,
   * then waits for the deadline to pass.
   * Returns { campaignPda, creator, vaultPda, goal }.
   *
   * Note: `creator` is resolved via `relations` in the IDL — Anchor knows its
   * address but does NOT add it as a transaction signer automatically when it
   * is not the default wallet. Always pass it explicitly via accountsPartial.
   */
  async function setupWithdrawableCampaign(goalLamports = new anchor.BN(2_000_000_000)) {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, goalLamports, deadline);
    const vaultPda = getVaultPda(program.programId, campaignPda);

    // Contribute exactly the goal amount so the campaign is withdrawable.
    await program.methods
      .contribute(goalLamports)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Wait for the deadline to clearly pass.
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    return { campaignPda, creator, vaultPda, goal: goalLamports };
  }

  // ---------------------------------------------------------------------------

  it("Creator withdraws all funds after deadline and goal are met", async () => {
    const { campaignPda, creator, vaultPda, goal } = await setupWithdrawableCampaign();

    const creatorBalanceBefore = await provider.connection.getBalance(creator.publicKey);

    // Pass creator explicitly via accountsPartial — relations resolution alone
    // does not register the keypair as a transaction signer.
    await program.methods
      .withdraw()
      .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Campaign account stays open so associated Contribution accounts remain accessible.
    // The claimed flag is the guard against double-withdrawal.
    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.isTrue(campaign.claimed, "campaign should be marked as claimed after withdrawal");

    // Vault must be empty — all lamports moved to creator.
    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, 0);

    // Creator balance must have grown by at least the goal (minus tx fees).
    const creatorBalanceAfter = await provider.connection.getBalance(creator.publicKey);
    assert.ok(
      creatorBalanceAfter > creatorBalanceBefore,
      "creator balance should increase after withdrawal"
    );
    assert.ok(
      creatorBalanceAfter >= creatorBalanceBefore + goal.toNumber() - 10_000,
      "creator should receive at least goal lamports minus tx fees"
    );
  });

  it("Fails when deadline has not passed yet", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    // Long deadline — will not expire during this test.
    const goal = new anchor.BN(1_000_000_000);
    const campaignPda = await createCampaign(program, creator, goal);

    // Contribute to meet the goal.
    await program.methods
      .contribute(goal)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    // Attempt to withdraw immediately — deadline has not passed.
    try {
      await program.methods
        .withdraw()
        .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineNotReached error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineNotReached");
      assert.strictEqual(err.error.errorCode.number, 6004);
    }
  });

  it("Fails when goal has not been reached", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const goal = new anchor.BN(5_000_000_000); // 5 SOL goal
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, goal, deadline);

    // Contribute only half the goal — not enough to unlock withdrawal.
    const halfGoal = new anchor.BN(2_500_000_000);
    await program.methods
      .contribute(halfGoal)
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    try {
      await program.methods
        .withdraw()
        .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with GoalNotReached error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "GoalNotReached");
      assert.strictEqual(err.error.errorCode.number, 6005);
    }
  });

  it("Fails when funds have already been claimed", async () => {
    const { campaignPda, creator } = await setupWithdrawableCampaign();

    // First withdraw — should succeed.
    await program.methods
      .withdraw()
      .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Second withdraw — must be rejected with AlreadyClaimed.
    // The campaign account stays open with claimed = true, so the CEI guard fires.
    try {
      await program.methods
        .withdraw()
        .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected second withdrawal to fail with AlreadyClaimed");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "AlreadyClaimed");
    }
  });

  it("Fails when a non-creator tries to withdraw", async () => {
    const { campaignPda } = await setupWithdrawableCampaign();

    const impostor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, impostor.publicKey);

    try {
      // Force the impostor's key as creator — has_one = creator @ Unauthorized
      // will reject it because impostor.publicKey != campaign.creator.
      await (program.methods.withdraw() as any)
        .accountsPartial({ campaign: campaignPda, creator: impostor.publicKey })
        .signers([impostor])
        .rpc();
      assert.fail("Expected transaction to fail with Unauthorized error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "Unauthorized");
      assert.strictEqual(err.error.errorCode.number, 6007);
    }
  });
});
