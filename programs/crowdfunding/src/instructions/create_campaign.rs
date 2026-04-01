use anchor_lang::prelude::*;

use crate::errors::CrowdfundingError;
use crate::Campaign;

/// Creates a new fundraising campaign as a PDA owned by the program.
///
/// # Arguments
/// * `goal`     - Target amount in lamports the campaign must raise
/// * `deadline` - Unix timestamp after which funds can be withdrawn or refunded
///
/// # Side Effects
/// Initialises the `Campaign` account and logs creation details.
pub fn create_campaign(ctx: Context<CreateCampaign>, goal: u64, deadline: i64) -> Result<()> {
    let clock = Clock::get()?;

    require!(goal > 0, CrowdfundingError::ZeroGoal);
    require!(
        deadline > clock.unix_timestamp,
        CrowdfundingError::DeadlineInPast
    );

    let campaign = &mut ctx.accounts.campaign;
    campaign.creator = ctx.accounts.creator.key();
    campaign.goal = goal;
    campaign.raised = 0;
    campaign.deadline = deadline;
    campaign.claimed = false;
    campaign.bump = ctx.bumps.campaign;

    msg!("Campaign created: goal={}, deadline={}", goal, deadline);
    Ok(())
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    /// The campaign account — a PDA seeded by the creator's public key.
    /// One campaign per creator address.
    #[account(
        init,
        payer = creator,
        space = Campaign::LEN,
        seeds = [b"campaign", creator.key().as_ref()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    /// The wallet that creates and funds the campaign account rent.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
