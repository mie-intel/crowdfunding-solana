use anchor_lang::prelude::*;

/// Tracks a single contributor's cumulative deposit into one campaign.
///
/// One account exists per `(campaign, contributor)` pair, created on the
/// contributor's first call to `contribute` via `init_if_needed` and
/// updated on every subsequent call. Closed by `refund`, which returns
/// its rent lamports to the contributor.
///
/// PDA seeds: `["contribution", campaign, contributor]`
#[account]
pub struct Contribution {
    /// The wallet that made the contribution.
    pub contributor: Pubkey,
    /// The campaign this contribution belongs to.
    pub campaign: Pubkey,
    /// Cumulative lamports contributed across all `contribute` calls.
    /// Snapshotted by `refund` before the vault transfer.
    pub amount: u64,
    /// Canonical PDA bump, stored to avoid re-derivation on every CPI.
    pub bump: u8,
}

impl Contribution {
    /// On-chain space required for this account.
    ///
    /// ```text
    /// 8   discriminator
    /// 32  contributor: Pubkey
    /// 32  campaign: Pubkey
    /// 8   amount: u64
    /// 1   bump: u8
    /// ```
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1;
}
