use anchor_lang::prelude::*;

/// Tracks a single contributor's cumulative deposit into one campaign.
/// PDA seeds: ["contribution", campaign, contributor]
#[account]
pub struct Contribution {
    pub contributor: Pubkey, // Who made the contribution
    pub campaign: Pubkey,    // Which campaign this belongs to
    pub amount: u64,         // Cumulative lamports contributed
    pub bump: u8,            // PDA bump seed
}

impl Contribution {
    // 8 (discriminator) + 32 + 32 (Pubkeys) + 8 (u64) + 1 (u8)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}
