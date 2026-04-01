use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("GmTDmgxynhiV22nrhgaDR9urVQSohyY7tTU5C938bta7");

#[program]
pub mod crowdfunding {
    use super::*;

    pub fn create_campaign(ctx: Context<CreateCampaign>, goal: u64, deadline: i64) -> Result<()> {
        instructions::create_campaign::create_campaign(ctx, goal, deadline)
    }
}

// --- Account Structs ---

#[account]
pub struct Campaign {
    pub creator: Pubkey, // Who created this campaign
    pub goal: u64,       // Target amount in lamports
    pub raised: u64,     // Total lamports raised so far
    pub deadline: i64,   // Unix timestamp when campaign ends
    pub claimed: bool,   // Whether funds have been withdrawn
    pub bump: u8,        // PDA bump seed, stored for efficient re-derivation
}

impl Campaign {
    // 8 (discriminator) + 32 (Pubkey) + 8 + 8 + 8 (u64s) + 1 (bool) + 1 (u8)
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1 + 1;
}
