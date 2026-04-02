use anchor_lang::prelude::*;

/// Global singleton that issues sequential campaign IDs.
///
/// Created once on the first `create_campaign` call via `init_if_needed`,
/// then reused for every subsequent campaign. Acts as an on-chain
/// auto-increment primary key — the same concept as a database sequence.
///
/// PDA seeds: `["registry"]`
#[account]
pub struct CampaignRegistry {
    /// The ID that will be assigned to the next campaign.
    /// Incremented atomically inside `create_campaign`.
    pub campaign_count: u64,
    /// Canonical PDA bump, stored to avoid re-derivation on every CPI.
    pub bump: u8,
}

impl CampaignRegistry {
    /// On-chain space required for this account.
    /// 8 (discriminator) + 8 (u64) + 1 (u8)
    pub const LEN: usize = 8 + 8 + 1;
}

/// Stores all metadata and state for a single fundraising campaign.
///
/// One account is created per campaign, keyed by its sequential ID.
/// PDAs act as an on-chain hashmap: given any campaign ID, a client derives
/// its address deterministically in O(1) — no iteration or index needed.
///
/// PDA seeds: `["campaign", id.to_le_bytes()]`
#[account]
pub struct Campaign {
    /// Sequential campaign ID issued by [`CampaignRegistry`].
    /// Doubles as the PDA seed, enabling O(1) lookup by index.
    pub id: u64,
    /// The wallet that created this campaign; only they may call `withdraw`.
    pub creator: Pubkey,
    /// Human-readable campaign title. Capped at [`Campaign::MAX_TITLE_LEN`] bytes.
    pub title: String,
    /// Campaign description. Capped at [`Campaign::MAX_DESCRIPTION_LEN`] bytes.
    pub description: String,
    /// Fundraising target in lamports. Must be greater than zero.
    pub goal: u64,
    /// Total lamports contributed so far. Accumulated by `contribute`.
    pub raised: u64,
    /// Unix timestamp after which contributions are rejected and
    /// `withdraw` / `refund` become available.
    pub deadline: i64,
    /// Set to `true` by `withdraw` before the vault CPI, preventing
    /// double-withdrawal via the CEI reentrancy guard.
    pub claimed: bool,
    /// Canonical PDA bump, stored to avoid re-derivation on every CPI.
    pub bump: u8,
}

impl Campaign {
    /// Maximum allowed byte length for [`Campaign::title`].
    pub const MAX_TITLE_LEN: usize = 50;
    /// Maximum allowed byte length for [`Campaign::description`].
    pub const MAX_DESCRIPTION_LEN: usize = 200;

    /// On-chain space required for this account.
    ///
    /// ```text
    /// 8   discriminator
    /// 8   id: u64
    /// 32  creator: Pubkey
    /// 54  title: String (4-byte length prefix + 50 bytes)
    /// 204 description: String (4-byte length prefix + 200 bytes)
    /// 8   goal: u64
    /// 8   raised: u64
    /// 8   deadline: i64
    /// 1   claimed: bool
    /// 1   bump: u8
    /// ```
    pub const LEN: usize = 8 + 8 + 32 + (4 + 50) + (4 + 200) + 8 + 8 + 8 + 1 + 1;
}
