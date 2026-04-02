import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";

describe("Campaign Creation", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports = 2_000_000_000) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...latestBlockhash });
  }

  it("Creates a campaign", async () => {
    const goal = new anchor.BN(1_000_000_000); // 1 SOL in lamports
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 60 * 60); // 1 hour from now

    const [campaignPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .createCampaign(goal, deadline)
      .accounts({ creator: provider.wallet.publicKey })
      .rpc();

    console.log("Transaction signature:", tx);

    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok(campaign.creator.equals(provider.wallet.publicKey));
    assert.ok(campaign.goal.eq(goal));
    assert.ok(campaign.raised.eqn(0));
    assert.ok(campaign.deadline.eq(deadline));
    assert.isFalse(campaign.claimed);
  });

  it("Fails when goal is zero", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(creator.publicKey);

    const goal = new anchor.BN(0);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 60 * 60);

    try {
      await program.methods
        .createCampaign(goal, deadline)
        .accounts({ creator: creator.publicKey })
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
    await airdrop(creator.publicKey);

    const goal = new anchor.BN(1_000_000_000);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) - 1); // 1 second in the past

    try {
      await program.methods
        .createCampaign(goal, deadline)
        .accounts({ creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineInPast error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineInPast");
      assert.strictEqual(err.error.errorCode.number, 6001);
    }
  });

  it("Fails when deadline equals current timestamp", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(creator.publicKey);

    const goal = new anchor.BN(1_000_000_000);
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000)); // exactly now (not strictly future)

    try {
      await program.methods
        .createCampaign(goal, deadline)
        .accounts({ creator: creator.publicKey })
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
