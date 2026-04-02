use anchor_lang::prelude::*;

/// Emitted when a campaign is created. Clients subscribe to this event to
/// learn the campaign ID without polling — this is the on-chain "return value".
#[event]
pub struct CampaignCreated {
    pub id: u64,
    pub creator: Pubkey,
    pub title: String,
    pub description: String,
    pub goal: u64,
    pub deadline: i64,
}

/// Emitted on every successful contribution.
/// Allows off-chain indexers to reconstruct per-campaign and per-contributor
/// contribution history without scanning raw transaction logs.
#[event]
pub struct Contributed {
    pub campaign: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,       // Lamports transferred in this call
    pub total_raised: u64, // campaign.raised after this contribution
}

/// Emitted when the campaign creator successfully withdraws funds.
/// Provides an audit trail that funds were claimed and confirms the final
/// vault amount transferred.
#[event]
pub struct Withdrawn {
    pub campaign: Pubkey,
    pub creator: Pubkey,
    pub amount: u64, // Total lamports transferred out of the vault
}

/// Emitted when a contributor successfully claims a refund.
/// Allows indexers and clients to reconcile vault balances and confirm
/// that a specific contributor has been made whole.
#[event]
pub struct Refunded {
    pub campaign: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64, // Lamports returned to the contributor
}
