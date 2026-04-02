use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::CrowdfundingError;
use crate::events::Contributed;
use crate::state::{Campaign, Contribution};

/// Contributes SOL to an active campaign.
///
/// Transfers `amount` lamports from the contributor to the campaign's vault PDA,
/// then creates (or updates) the contributor's `Contribution` record and
/// increments `campaign.raised`.
///
/// # Arguments
/// * `amount` - Lamports to contribute; must be greater than zero.
///
/// # Errors
/// * [`CrowdfundingError::ZeroAmount`]    — amount is zero.
/// * [`CrowdfundingError::CampaignEnded`] — the campaign deadline has passed.
/// * [`CrowdfundingError::Overflow`]      — raised amount or contribution amount would overflow u64.
pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;

    require!(amount > 0, CrowdfundingError::ZeroAmount);
    require!(
        clock.unix_timestamp < ctx.accounts.campaign.deadline,
        CrowdfundingError::CampaignEnded
    );

    // --- Effects (state updates before any CPI) ---
    //
    // Following CEI (Checks-Effects-Interactions): mutate all on-chain state
    // before the external call so a reentrant CPI cannot observe stale state.

    // Increment campaign's total raised (checked to prevent overflow).
    let campaign = &mut ctx.accounts.campaign;
    campaign.raised = campaign
        .raised
        .checked_add(amount)
        .ok_or(CrowdfundingError::Overflow)?;

    // On first contribution the account is zero-initialised by `init_if_needed`;
    // detect this by checking whether the campaign field is still the default pubkey.
    let contribution = &mut ctx.accounts.contribution;
    if contribution.campaign == Pubkey::default() {
        contribution.contributor = ctx.accounts.contributor.key();
        contribution.campaign = campaign.key();
        contribution.bump = ctx.bumps.contribution;
    }

    contribution.amount = contribution
        .amount
        .checked_add(amount)
        .ok_or(CrowdfundingError::Overflow)?;

    // --- Interaction (CPI after all state is finalised) ---
    //
    // Transfer SOL from contributor to vault. Any reentrant call at this point
    // would see the already-updated raised/contribution amounts.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.contributor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(Contributed {
        campaign: ctx.accounts.campaign.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
        total_raised: ctx.accounts.campaign.raised,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    /// The campaign receiving the contribution.
    /// Validated as a Program-owned Campaign account; deadline enforced in handler.
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA that custodies the SOL for this campaign.
    /// Seeds: ["vault", campaign] — system-owned, no data, holds lamports only.
    ///
    /// CHECK: PDA is validated by seeds. It is a system-owned account used solely
    /// to hold lamports; no data is read from or written to it.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// Per-(campaign, contributor) contribution record.
    /// Created on the first call; updated on subsequent calls.
    #[account(
        init_if_needed,
        payer = contributor,
        space = Contribution::LEN,
        seeds = [b"contribution", campaign.key().as_ref(), contributor.key().as_ref()],
        bump,
    )]
    pub contribution: Account<'info, Contribution>,

    /// The wallet making the contribution; pays for the Contribution account rent
    /// on the first call and for the transferred lamports on every call.
    #[account(mut)]
    pub contributor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

