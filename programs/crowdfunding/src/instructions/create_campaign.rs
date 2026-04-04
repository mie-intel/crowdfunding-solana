use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::CrowdfundingError;
use crate::events::CampaignCreated;
use crate::state::{Campaign, CampaignRegistry};

/// Creates a new fundraising campaign and assigns it a unique sequential ID.
///
/// Each creator has their own `CampaignRegistry` PDA (seeded by their pubkey),
/// so campaign-creation throughput scales with the number of unique creators
/// rather than being bottlenecked by a single global account.
///
/// The vault PDA is pre-funded with the rent-exempt minimum so that even a
/// contribution of 1 lamport never fails the Solana rent check.
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
/// * Initialises (or reuses) the creator's `CampaignRegistry` account.
/// * Initialises the `Campaign` account.
/// * Pre-funds the vault PDA with the rent-exempt minimum.
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
    // Each creator has an independent counter, so campaign IDs are unique per
    // (creator, id) pair. Clients derive the PDA as:
    // PDA(["campaign", creator, id.to_le_bytes()]).
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

    // Pre-fund the vault with the rent-exempt minimum so that any contribution
    // amount — even 1 lamport — passes Solana's rent check on the first transfer.
    let rent = Rent::get()?;
    let vault_rent_min = rent.minimum_balance(0);
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        vault_rent_min,
    )?;

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

    Ok(())
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    /// Per-creator registry that issues sequential campaign IDs.
    /// Sharding by creator eliminates the single global write bottleneck:
    /// concurrent campaign creation from different wallets no longer contends
    /// on one account.
    #[account(
        init_if_needed,
        payer = creator,
        space = CampaignRegistry::LEN,
        seeds = [b"registry", creator.key().as_ref()],
        bump,
    )]
    pub registry: Account<'info, CampaignRegistry>,

    /// The campaign account — PDA keyed by (creator, sequential ID).
    /// Seeds: ["campaign", creator, registry.campaign_count.to_le_bytes()]
    ///
    /// Using creator + counter as the seed makes the PDA unique per creator
    /// and enables O(1) lookup: given creator and ID, the address is fully
    /// deterministic. Two different creators can both have campaign ID 0
    /// without collision.
    #[account(
        init,
        payer = creator,
        space = Campaign::LEN,
        seeds = [b"campaign", creator.key().as_ref(), registry.campaign_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub campaign: Account<'info, Campaign>,

    /// Vault PDA that will custody the campaign's SOL contributions.
    /// Pre-funded here with the rent-exempt minimum (creator pays) so that
    /// even a 1-lamport first contribution never fails Solana's rent check.
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The wallet paying for account rent; becomes the campaign creator.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}
