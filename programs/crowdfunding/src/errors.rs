use anchor_lang::prelude::*;

#[error_code]
pub enum CrowdfundingError {
    #[msg("Campaign goal must be greater than zero")]
    ZeroGoal,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Contribution amount must be greater than zero")]
    ZeroAmount,
    #[msg("Campaign has already ended")]
    CampaignEnded,
    #[msg("Campaign deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Campaign has not reached its goal")]
    GoalNotReached,
    #[msg("Funds have already been withdrawn")]
    AlreadyClaimed,
    #[msg("Only the campaign creator can withdraw")]
    Unauthorized,
    #[msg("Campaign goal was reached; refunds are not available")]
    GoalReached,
    #[msg("No contribution found to refund")]
    NothingToRefund,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Title exceeds maximum length of 50 characters")]
    TitleTooLong,
    #[msg("Description exceeds maximum length of 200 characters")]
    DescTooLong,
    #[msg("Campaign already has contributions; cannot cancel")]
    HasContributions,
}
