use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use events::*;
pub use state::*;

use instructions::*;

declare_id!("Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S");

#[program]
pub mod crowdfunding {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        title: String,
        description: String,
        goal: u64,
        deadline: i64,
    ) -> Result<()> {
        instructions::create_campaign::create_campaign(ctx, title, description, goal, deadline)
    }

    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::contribute::contribute(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        instructions::withdraw::withdraw(ctx)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::refund(ctx)
    }

    pub fn cancel_campaign(ctx: Context<CancelCampaign>) -> Result<()> {
        instructions::cancel::cancel_campaign(ctx)
    }

    pub fn expire_campaign(ctx: Context<ExpireCampaign>) -> Result<()> {
        instructions::expire::expire_campaign(ctx)
    }
}
