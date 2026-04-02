use anchor_lang::prelude::*;

use crate::errors::CrowdfundingError;
use crate::events::CampaignCreated;
use crate::state::{Campaign, CampaignRegistry};

/// Creates a new fundraising campaign and assigns it a unique sequential ID.
///
/// The ID is issued by the global `CampaignRegistry` singleton (similar to a
/// database auto-increment). Clients can later look up any campaign in O(1) by
/// deriving its PDA from the ID — no on-chain iteration required.
///
/// The assigned campaign ID is emitted as a `CampaignCreated` event so callers
/// can observe it (Solana instructions do not return values to the caller).
///
/// # Arguments
/// * `title`       - Campaign title; max 50 characters.
/// * `description` - Campaign description; max 200 characters.
/// * `goal`        - Target amount in lamports; must be greater than zero.
/// * `deadline`    - Unix timestamp after which funds can be withdrawn or refunded;
///                   must be strictly in the future.
///
/// # Errors
/// * [`CrowdfundingError::ZeroGoal`]        — goal is zero.
/// * [`CrowdfundingError::DeadlineInPast`]  — deadline is not in the future.
/// * [`CrowdfundingError::TitleTooLong`]    — title exceeds 50 characters.
/// * [`CrowdfundingError::DescTooLong`]     — description exceeds 200 characters.
/// * [`CrowdfundingError::Overflow`]        — campaign_count would overflow u64.
///
/// # Side Effects
/// * Initialises (or reuses) the `CampaignRegistry` account.
/// * Initialises the `Campaign` account.
/// * Increments `registry.campaign_count`.
/// * Emits a `CampaignCreated` event.
pub fn create_campaign(
    ctx: Context<CreateCampaign>,
    title: String,
    description: String,
    goal: u64,
    deadline: i64,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(goal > 0, CrowdfundingError::ZeroGoal);
    require!(
        deadline > clock.unix_timestamp,
        CrowdfundingError::DeadlineInPast
    );
    require!(
        title.len() <= Campaign::MAX_TITLE_LEN,
        CrowdfundingError::TitleTooLong
    );
    require!(
        description.len() <= Campaign::MAX_DESCRIPTION_LEN,
        CrowdfundingError::DescTooLong
    );

    // Snapshot the current count — this becomes the new campaign's ID.
    // Conceptually identical to an array index: campaign[id] lives at the PDA
    // derived from ["campaign", id.to_le_bytes()].
    let registry = &mut ctx.accounts.registry;
    let campaign_id = registry.campaign_count;

    // Always write the registry bump (idempotent on subsequent calls via init_if_needed).
    registry.bump = ctx.bumps.registry;
    registry.campaign_count = campaign_id
        .checked_add(1)
        .ok_or(CrowdfundingError::Overflow)?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.id = campaign_id;
    campaign.creator = ctx.accounts.creator.key();
    campaign.title = title.clone();
    campaign.description = description.clone();
    campaign.goal = goal;
    campaign.raised = 0;
    campaign.deadline = deadline;
    campaign.claimed = false;
    campaign.bump = ctx.bumps.campaign;

    // Emit the ID so the client can track it. In Solana, events are the
    // equivalent of a function return value for off-chain consumers.
    emit!(CampaignCreated {
        id: campaign_id,
        creator: ctx.accounts.creator.key(),
        title,
        description,
        goal,
        deadline,
    });

    msg!(
        "Campaign created: id={}, title={}, goal={}, deadline={}",
        campaign_id,
        campaign.title,
        goal,
        deadline
    );
    Ok(())
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    /// Global registry that issues sequential campaign IDs.
    /// Created on the very first campaign; reused for all subsequent ones.
    #[account(
        init_if_needed,
        payer = creator,
        space = CampaignRegistry::LEN,
        seeds = [b"registry"],
        bump,
    )]
    pub registry: Account<'info, CampaignRegistry>,

    /// The campaign account — PDA keyed by the sequential ID.
    /// Seeds: ["campaign", registry.campaign_count.to_le_bytes()]
    ///
    /// Using the counter as the seed is what enables unlimited campaigns:
    /// each ID maps to a unique PDA address, just like an array index maps to
    /// a memory address. Any client can look up campaign N in O(1) by deriving
    /// PDA(["campaign", N]).
    #[account(
        init,
        payer = creator,
        space = Campaign::LEN,
        seeds = [b"campaign", registry.campaign_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    /// The wallet paying for account rent; becomes the campaign creator.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
