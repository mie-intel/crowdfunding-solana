use anchor_lang::prelude::*;

use crate::errors::CrowdfundingError;
use crate::events::CampaignExpired;
use crate::state::Campaign;

/// Closes an expired campaign that received zero contributions, returning rent to the creator.
///
/// This is a permissionless cleanup instruction — anyone may call it. This allows
/// keeper bots or frontends to reclaim storage for abandoned campaigns without
/// requiring the creator to be online. The rent always goes back to the creator,
/// never the caller.
///
/// Two conditions must both hold:
/// 1. The campaign deadline has passed.
/// 2. No contributions were ever received (`raised == 0`), meaning the vault is empty.
///
/// Campaigns that received contributions but failed to reach the goal are handled
/// by individual `refund` calls, not this instruction.
///
/// # Errors
/// * [`CrowdfundingError::DeadlineNotReached`] — deadline has not passed yet; use `cancel_campaign` instead.
/// * [`CrowdfundingError::HasContributions`]   — campaign has contributions; contributors must call `refund`.
///
/// # Side Effects
/// * `Campaign` account is closed; rent returned to the original creator.
/// * Emits a `CampaignExpired` event.
pub fn expire_campaign(ctx: Context<ExpireCampaign>) -> Result<()> {
    let clock = Clock::get()?;
    let campaign = &ctx.accounts.campaign;

    // --- Checks ---
    require!(
        clock.unix_timestamp >= campaign.deadline,
        CrowdfundingError::DeadlineNotReached
    );
    // If raised > 0, the vault holds contributor funds — use refund, not expire.
    require!(campaign.raised == 0, CrowdfundingError::HasContributions);

    emit!(CampaignExpired {
        campaign: ctx.accounts.campaign.key(),
        creator: ctx.accounts.creator.key(),
    });

    // `close = creator` zeroes the account data and transfers all lamports
    // (including rent) to the creator after this handler returns.
    Ok(())
}

#[derive(Accounts)]
pub struct ExpireCampaign<'info> {
    /// The expired campaign to close.
    /// `has_one = creator` prevents a caller from redirecting rent to a wrong account.
    /// `close = creator` returns the rent to the original creator.
    #[account(
        mut,
        has_one = creator,
        close = creator,
    )]
    pub campaign: Account<'info, Campaign>,

    /// The campaign creator who receives the reclaimed rent.
    /// Does not need to sign — anyone may trigger cleanup of an expired campaign.
    #[account(mut)]
    pub creator: SystemAccount<'info>,

    /// Anyone may submit this transaction; they pay the network fee.
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
