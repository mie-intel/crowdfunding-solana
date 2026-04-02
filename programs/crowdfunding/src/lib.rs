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

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::contribute::contribute(ctx, amount)
    }
}

// --- Account Structs ---

/// Global singleton that issues sequential campaign IDs.
/// PDA seeds: ["registry"]
/// This is the on-chain equivalent of an auto-increment primary key.
#[account]
pub struct CampaignRegistry {
    pub campaign_count: u64, // Next campaign ID to be assigned
    pub bump: u8,            // PDA bump seed
}

impl CampaignRegistry {
    // 8 (discriminator) + 8 (u64) + 1 (u8)
    pub const LEN: usize = 8 + 8 + 1;
}

/// One account per campaign, keyed by sequential ID.
/// PDA seeds: ["campaign", id.to_le_bytes()]
///
/// PDAs act as an on-chain hashmap: given any campaign ID, a client derives
/// its address deterministically in O(1) — no iteration or index needed.
#[account]
pub struct Campaign {
    pub id: u64,         // Sequential campaign ID (issued by CampaignRegistry)
    pub creator: Pubkey, // Who created this campaign
    pub goal: u64,       // Target amount in lamports
    pub raised: u64,     // Total lamports raised so far
    pub deadline: i64,   // Unix timestamp when campaign ends
    pub claimed: bool,   // Whether funds have been withdrawn
    pub bump: u8,        // PDA bump seed, stored for efficient re-derivation
}

impl Campaign {
    // 8 (discriminator) + 8 (id) + 32 (Pubkey) + 8 + 8 + 8 (u64s) + 1 (bool) + 1 (u8)
    pub const LEN: usize = 8 + 8 + 32 + 8 + 8 + 8 + 1 + 1;
}

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

// --- Events ---

/// Emitted when a campaign is created. Clients subscribe to this event to
/// learn the campaign ID without polling — this is the on-chain "return value".
#[event]
pub struct CampaignCreated {
    pub id: u64,
    pub creator: Pubkey,
    pub goal: u64,
    pub deadline: i64,
}
