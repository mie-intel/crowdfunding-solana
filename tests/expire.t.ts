import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import { airdrop, createCampaign, SHORT_DEADLINE_SEC, WAIT_MS } from "./helpers";

describe("Expire Campaign", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("Anyone can expire a zero-contribution campaign after deadline — account closed, rent returned to creator", async () => {
    const creator = anchor.web3.Keypair.generate();
    const caller = anchor.web3.Keypair.generate(); // a third party, not the creator
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, caller.publicKey);

    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, new anchor.BN(5_000_000_000), deadline);

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    const creatorBalanceBefore = await provider.connection.getBalance(creator.publicKey);

    await program.methods
      .expireCampaign()
      .accounts({ campaign: campaignPda, creator: creator.publicKey, caller: caller.publicKey })
      .signers([caller])
      .rpc();

    // Campaign account must be closed.
    const accountInfo = await provider.connection.getAccountInfo(campaignPda);
    assert.isNull(accountInfo, "campaign account should be closed after expire");

    // Creator receives the rent — not the caller.
    const creatorBalanceAfter = await provider.connection.getBalance(creator.publicKey);
    assert.ok(
      creatorBalanceAfter > creatorBalanceBefore,
      "creator balance should increase after rent is returned"
    );
  });

  it("Creator can also expire their own campaign after deadline", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, new anchor.BN(5_000_000_000), deadline);

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    await program.methods
      .expireCampaign()
      .accounts({ campaign: campaignPda, creator: creator.publicKey, caller: creator.publicKey })
      .signers([creator])
      .rpc();

    const accountInfo = await provider.connection.getAccountInfo(campaignPda);
    assert.isNull(accountInfo, "campaign account should be closed");
  });

  // ---------------------------------------------------------------------------
  // Deadline checks
  // ---------------------------------------------------------------------------

  it("Fails when deadline has not passed yet — DeadlineNotReached (6004)", async () => {
    const creator = anchor.web3.Keypair.generate();
    const caller = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, caller.publicKey);

    // Long deadline — will not expire during this test.
    const campaignPda = await createCampaign(program, creator);

    try {
      await program.methods
        .expireCampaign()
        .accounts({ campaign: campaignPda, creator: creator.publicKey, caller: caller.publicKey })
        .signers([caller])
        .rpc();
      assert.fail("Expected transaction to fail with DeadlineNotReached error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "DeadlineNotReached");
      assert.strictEqual(err.error.errorCode.number, 6004);
    }
  });

  // ---------------------------------------------------------------------------
  // Contribution guard
  // ---------------------------------------------------------------------------

  it("Fails when campaign has contributions — HasContributions (6013)", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    const caller = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);
    await airdrop(provider.connection, caller.publicKey);

    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, new anchor.BN(10_000_000_000), deadline);

    // Contribute so raised > 0 — these funds belong to the contributor, not expire logic.
    await program.methods
      .contribute(new anchor.BN(1_000_000_000))
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    try {
      await program.methods
        .expireCampaign()
        .accounts({ campaign: campaignPda, creator: creator.publicKey, caller: caller.publicKey })
        .signers([caller])
        .rpc();
      assert.fail("Expected transaction to fail with HasContributions error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "HasContributions");
      assert.strictEqual(err.error.errorCode.number, 6013);
    }
  });
});
