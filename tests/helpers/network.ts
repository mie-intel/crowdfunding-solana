import * as anchor from "@coral-xyz/anchor";

export async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: anchor.web3.PublicKey,
  lamports = 10_000_000_000
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
}
