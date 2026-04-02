use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::CrowdfundingError;
use crate::events::Refunded;
use crate::state::{Campaign, Contribution};

/// Refunds a contributor's SOL when a campaign fails to reach its goal.
///
/// Two conditions must both hold:
/// 1. The campaign deadline has passed.
/// 2. The campaign did NOT reach its goal (`raised < goal`).
///
/// Transfers the contributor's deposited lamports from the vault back to the
/// contributor, then closes the `Contribution` account so its rent is also
/// returned to the contributor.
///
/// Follows CEI: all checks run before the vault transfer (interaction).
/// The account closure is handled by Anchor's `close` constraint after the
/// handler returns, which is safe because the refund amount is snapshotted
/// before the handler body executes.
///
/// # Errors
/// * [`CrowdfundingError::DeadlineNotReached`] — deadline has not passed yet.
/// * [`CrowdfundingError::GoalReached`]         — goal was met; use `withdraw` instead.
/// * [`CrowdfundingError::NothingToRefund`]     — contributor has no recorded deposit.
pub fn refund(ctx: Context<Refund>) -> Result<()> {
    let clock = Clock::get()?;
    let campaign = &ctx.accounts.campaign;

    // --- Checks ---
    require!(
        clock.unix_timestamp >= campaign.deadline,
        CrowdfundingError::DeadlineNotReached
    );
    require!(
        campaign.raised < campaign.goal,
        CrowdfundingError::GoalReached
    );

    let refund_amount = ctx.accounts.contribution.amount;
    require!(refund_amount > 0, CrowdfundingError::NothingToRefund);

    // --- Interaction ---
    // Transfer the contributor's deposited lamports from the vault back.
    // Signed with vault PDA seeds since the vault has no private key.
    let campaign_key = ctx.accounts.campaign.key();
    let vault_bump = ctx.bumps.vault;

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.contributor.to_account_info(),
            },
            &[&[b"vault", campaign_key.as_ref(), &[vault_bump]]],
        ),
        refund_amount,
    )?;

    // The `close = contributor` constraint on the contribution account
    // zeroes its data and transfers its rent lamports to the contributor
    // automatically after this handler returns.

    emit!(Refunded {
        campaign: campaign_key,
        contributor: ctx.accounts.contributor.key(),
        amount: refund_amount,
    });

    msg!(
        "Refund: contributor={}, amount={}, campaign={}",
        ctx.accounts.contributor.key(),
        refund_amount,
        campaign_key,
    );

    Ok(())
}

#[derive(Accounts)]
pub struct Refund<'info> {
    /// The campaign being refunded from.
    /// Deadline and goal are checked in the handler.
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA holding the campaign's SOL.
    /// Seeds must match those used in `contribute`.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The contributor's deposit record.
    /// `close = contributor` zeroes the account and returns its rent to the
    /// contributor after the handler — reclaiming storage on-chain.
    #[account(
        mut,
        close = contributor,
        seeds = [b"contribution", campaign.key().as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Account<'info, Contribution>,

    /// The contributor receiving the refund and the closed account's rent.
    #[account(mut)]
    pub contributor: Signer<'info>,

    pub system_program: Program<'info, System>,
}
