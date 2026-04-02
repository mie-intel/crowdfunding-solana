use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::CrowdfundingError;
use crate::events::Withdrawn;
use crate::state::Campaign;

/// Withdraws all funds from a campaign vault to the creator's wallet.
///
/// Three conditions must all hold:
/// 1. The caller is the campaign creator (`has_one` enforced by Anchor).
/// 2. The campaign deadline has passed.
/// 3. The campaign reached its goal (`raised >= goal`).
///
/// Follows CEI: `campaign.claimed` is set to `true` before the SOL transfer
/// so a reentrant call would fail the `!campaign.claimed` check.
///
/// # Errors
/// * [`CrowdfundingError::Unauthorized`]      — signer is not the campaign creator.
/// * [`CrowdfundingError::DeadlineNotReached`] — deadline has not passed yet.
/// * [`CrowdfundingError::GoalNotReached`]     — raised amount is below goal.
/// * [`CrowdfundingError::AlreadyClaimed`]     — funds were already withdrawn.
pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let clock = Clock::get()?;
    let campaign = &ctx.accounts.campaign;

    // --- Checks ---
    require!(
        clock.unix_timestamp >= campaign.deadline,
        CrowdfundingError::DeadlineNotReached
    );
    require!(
        campaign.raised >= campaign.goal,
        CrowdfundingError::GoalNotReached
    );
    require!(!campaign.claimed, CrowdfundingError::AlreadyClaimed);

    let vault_lamports = ctx.accounts.vault.lamports();

    // --- Effect ---
    // Mark claimed before the transfer so any reentrant call sees the updated state.
    ctx.accounts.campaign.claimed = true;

    // --- Interaction ---
    // Sign the CPI with the vault's PDA seeds so the system program accepts the transfer.
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

    emit!(Withdrawn {
        campaign: campaign_key,
        creator: ctx.accounts.creator.key(),
        amount: vault_lamports,
    });

    msg!(
        "Withdraw: campaign={}, creator={}, amount={}",
        campaign_key,
        ctx.accounts.creator.key(),
        vault_lamports,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The campaign being withdrawn from.
    /// `has_one = creator` ensures only the original creator can sign.
    #[account(
        mut,
        has_one = creator @ CrowdfundingError::Unauthorized,
    )]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA that holds the campaign's SOL.
    /// Seeds: ["vault", campaign] — must match the seeds used in contribute.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The campaign creator receiving the funds; must match `campaign.creator`.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
