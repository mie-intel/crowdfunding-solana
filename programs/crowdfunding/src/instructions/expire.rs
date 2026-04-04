use anchor_lang::prelude::*;
use anchor_lang::system_program;

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
/// 2. No contributions were ever received (`raised == 0`), meaning the vault is empty
///    (except for the rent pre-funded at campaign creation).
///
/// Campaigns that received contributions but failed to reach the goal are handled
/// by individual `refund` calls, not this instruction.
///
/// # Errors
/// * [`CrowdfundingError::DeadlineNotReached`] — deadline has not passed yet; use `cancel_campaign` instead.
/// * [`CrowdfundingError::HasContributions`]   — campaign has contributions; contributors must call `refund`.
///
/// # Side Effects
/// * Vault lamports are returned to the original creator.
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

    /// Vault PDA holding the pre-funded rent (no contributions since raised == 0).
    /// Drained to creator before the campaign closes.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The campaign creator who receives the reclaimed rent.
    /// Does not need to sign — anyone may trigger cleanup of an expired campaign.
    #[account(mut)]
    pub creator: SystemAccount<'info>,

    /// Anyone may submit this transaction; they pay the network fee.
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}
