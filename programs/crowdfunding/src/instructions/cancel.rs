use anchor_lang::prelude::*;
use anchor_lang::system_program;

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
/// The vault PDA is also drained: since `raised == 0`, it only holds the rent
/// pre-funded at campaign creation, which is returned to the creator as well.
///
/// # Errors
/// * [`CrowdfundingError::Unauthorized`]      — signer is not the campaign creator.
/// * [`CrowdfundingError::CampaignEnded`]     — deadline has already passed; cancel is no longer available.
/// * [`CrowdfundingError::HasContributions`]  — campaign has already received contributions.
///
/// # Side Effects
/// * Vault lamports are returned to creator.
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

    // --- Interaction ---
    // Drain the pre-funded vault rent back to creator.
    // raised == 0 guarantees vault holds only the rent pre-funded at creation.
    let vault_lamports = ctx.accounts.vault.lamports();
    if vault_lamports > 0 {
        let campaign_key = ctx.accounts.campaign.key();
        let vault_bump = ctx.bumps.vault;
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator.to_account_info(),
                },
                &[&[b"vault", campaign_key.as_ref(), &[vault_bump]]],
            ),
            vault_lamports,
        )?;
    }

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

    /// Vault PDA holding the pre-funded rent (no contributions since raised == 0).
    /// Drained to creator before the campaign closes.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The campaign creator; must sign and receives the reclaimed rent.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
