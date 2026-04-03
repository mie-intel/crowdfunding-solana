import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";
import { airdrop, createCampaign, SHORT_DEADLINE_SEC, WAIT_MS } from "./helpers";

describe("Cancel Campaign", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  it("Creator cancels before deadline with zero contributions — account closed, rent returned", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    // Create a campaign with a long deadline (default 1 hour) and no contributions.
    const campaignPda = await createCampaign(program, creator);

    const balanceBefore = await provider.connection.getBalance(creator.publicKey);

    await program.methods
      .cancelCampaign()
      .accounts({ campaign: campaignPda, creator: creator.publicKey })
      .signers([creator])
      .rpc();

    // Campaign account must be closed (null means it no longer exists on-chain).
    const accountInfo = await provider.connection.getAccountInfo(campaignPda);
    assert.isNull(accountInfo, "campaign account should be closed after cancel");

    // Creator balance must increase because the campaign rent was returned.
    const balanceAfter = await provider.connection.getBalance(creator.publicKey);
    assert.ok(
      balanceAfter > balanceBefore,
      "creator balance should increase after rent is returned"
    );
  });

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  it("Fails when a non-creator tries to cancel — Unauthorized (6007)", async () => {
    const creator = anchor.web3.Keypair.generate();
    const impostor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, impostor.publicKey);

    const campaignPda = await createCampaign(program, creator);

    try {
      await program.methods
        .cancelCampaign()
        .accounts({ campaign: campaignPda, creator: impostor.publicKey })
        .signers([impostor])
        .rpc();
      assert.fail("Expected transaction to fail with Unauthorized error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "Unauthorized");
      assert.strictEqual(err.error.errorCode.number, 6007);
    }
  });

  // ---------------------------------------------------------------------------
  // Deadline checks
  // ---------------------------------------------------------------------------

  it("Fails when deadline has already passed — CampaignEnded (6003)", async () => {
    const creator = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);

    // Create a campaign with a short deadline and wait for it to expire.
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + SHORT_DEADLINE_SEC);
    const campaignPda = await createCampaign(program, creator, new anchor.BN(5_000_000_000), deadline);

    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

    try {
      await program.methods
        .cancelCampaign()
        .accounts({ campaign: campaignPda, creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with CampaignEnded error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "CampaignEnded");
      assert.strictEqual(err.error.errorCode.number, 6003);
    }
  });

  // ---------------------------------------------------------------------------
  // Contribution guard
  // ---------------------------------------------------------------------------

  it("Fails when campaign already has contributions — HasContributions (6013)", async () => {
    const creator = anchor.web3.Keypair.generate();
    const contributor = anchor.web3.Keypair.generate();
    await airdrop(provider.connection, creator.publicKey);
    await airdrop(provider.connection, contributor.publicKey);

    const campaignPda = await createCampaign(program, creator);

    // Make a contribution so raised > 0.
    await program.methods
      .contribute(new anchor.BN(1_000_000_000))
      .accounts({ campaign: campaignPda, contributor: contributor.publicKey })
      .signers([contributor])
      .rpc();

    try {
      await program.methods
        .cancelCampaign()
        .accounts({ campaign: campaignPda, creator: creator.publicKey })
        .signers([creator])
        .rpc();
      assert.fail("Expected transaction to fail with HasContributions error");
    } catch (err) {
      assert.ok(err instanceof anchor.AnchorError, "Expected an AnchorError");
      assert.strictEqual(err.error.errorCode.code, "HasContributions");
      assert.strictEqual(err.error.errorCode.number, 6013);
    }
  });
});
