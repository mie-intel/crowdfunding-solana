use anchor_lang::prelude::*;

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
    pub id: u64,              // Sequential campaign ID (issued by CampaignRegistry)
    pub creator: Pubkey,      // Who created this campaign
    pub title: String,        // Human-readable campaign title (max 50 chars)
    pub description: String,  // Campaign description (max 200 chars)
    pub goal: u64,            // Target amount in lamports
    pub raised: u64,          // Total lamports raised so far
    pub deadline: i64,        // Unix timestamp when campaign ends
    pub claimed: bool,        // Whether funds have been withdrawn
    pub bump: u8,             // PDA bump seed, stored for efficient re-derivation
}

impl Campaign {
    pub const MAX_TITLE_LEN: usize = 50;
    pub const MAX_DESCRIPTION_LEN: usize = 200;

    // 8  (discriminator)
    // + 8  (id: u64)
    // + 32 (creator: Pubkey)
    // + 4 + 50  (title: String prefix + max bytes)
    // + 4 + 200 (description: String prefix + max bytes)
    // + 8  (goal: u64)
    // + 8  (raised: u64)
    // + 8  (deadline: i64)
    // + 1  (claimed: bool)
    // + 1  (bump: u8)
    pub const LEN: usize = 8 + 8 + 32 + (4 + 50) + (4 + 200) + 8 + 8 + 8 + 1 + 1;
}

