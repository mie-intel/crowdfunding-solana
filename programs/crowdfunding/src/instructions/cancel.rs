use anchor_lang::prelude::*;

use crate::errors::CrowdfundingError;
use crate::events::CampaignCancelled;
use crate::state::Campaign;

/// Cancels a campaign before its deadline, returning the account rent to the creator.
///
/// Only the campaign creator may cancel, and only if no contributions have been
/// received yet (`raised == 0`). Once contributors have sent SOL, the campaign
/// cannot be cancelled — those funds are governed by `withdraw` or `refund`.
///
/// The `Campaign` account is closed and its rent lamports are returned to the creator.
///
/// # Errors
/// * [`CrowdfundingError::Unauthorized`]      — signer is not the campaign creator.
/// * [`CrowdfundingError::CampaignEnded`]     — deadline has already passed; cancel is no longer available.
/// * [`CrowdfundingError::HasContributions`]  — campaign has already received contributions.
///
/// # Side Effects
/// * `Campaign` account is closed; rent returned to creator.
/// * Emits a `CampaignCancelled` event.
pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
    let clock = Clock::get()?;
    let campaign = &ctx.accounts.campaign;

    // --- Checks ---
    require!(
        clock.unix_timestamp < campaign.deadline,
        CrowdfundingError::CampaignEnded
    );
    require!(campaign.raised == 0, CrowdfundingError::HasContributions);

    emit!(CampaignCancelled {
        campaign: ctx.accounts.campaign.key(),
        creator: ctx.accounts.creator.key(),
    });

    // `close = creator` zeroes the account data and transfers all lamports
    // (including rent) to the creator after this handler returns.
    Ok(())
}

#[derive(Accounts)]
pub struct CancelCampaign<'info> {
    /// The campaign to cancel.
    /// `has_one = creator` ensures only the original creator can sign.
    /// `close = creator` returns the rent to the creator on success.
    #[account(
        mut,
        has_one = creator @ CrowdfundingError::Unauthorized,
        close = creator,
    )]
    pub campaign: Account<'info, Campaign>,

    /// The campaign creator; must sign and receives the reclaimed rent.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
