import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crowdfunding } from "../target/types/crowdfunding";
import { assert } from "chai";

describe("crowdfunding", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Crowdfunding as Program<Crowdfunding>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  it("Creates a campaign", async () => {
    const goal = new anchor.BN(1_000_000_000); // 1 SOL in lamports
    const deadline = new anchor.BN(Math.floor(Date.now() / 1000) + 60 * 60); // 1 hour from now

    const [campaignPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    const tx = await program.methods
      .createCampaign(goal, deadline)
      .accounts({
        campaign: campaignPda,
        creator: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("Transaction signature:", tx);

    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.ok(campaign.creator.equals(provider.wallet.publicKey));
    assert.ok(campaign.goal.eq(goal));
    assert.ok(campaign.raised.eqn(0));
    assert.ok(campaign.deadline.eq(deadline));
    assert.isFalse(campaign.claimed);
  });
});
