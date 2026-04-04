import * as anchor from "@coral-xyz/anchor";

export function getRegistryPda(
  programId: anchor.web3.PublicKey,
  creator: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("registry"), creator.toBuffer()],
    programId
  );
  return pda;
}

export function getCampaignPda(
  programId: anchor.web3.PublicKey,
  creator: anchor.web3.PublicKey,
  id: anchor.BN
): anchor.web3.PublicKey {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    programId
  );
  return pda;
}

export function getVaultPda(
  programId: anchor.web3.PublicKey,
  campaignPda: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), campaignPda.toBuffer()],
    programId
  );
  return pda;
}

export function getContributionPda(
  programId: anchor.web3.PublicKey,
  campaignPda: anchor.web3.PublicKey,
  contributor: anchor.web3.PublicKey
): anchor.web3.PublicKey {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("contribution"), campaignPda.toBuffer(), contributor.toBuffer()],
    programId
  );
  return pda;
}
