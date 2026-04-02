# Crowdfunding — Solana / Anchor

A decentralized crowdfunding program built on Solana using the [Anchor](https://www.anchor-lang.com/) framework. Campaigns are created with a fundraising goal and deadline. Contributors send SOL directly into a per-campaign vault PDA. If the goal is met, the creator withdraws. If it is not, every contributor can claim a refund individually.

---

## Prerequisites

| Tool | Version |
|---|---|
| Rust | 1.89.0 (pinned via `rust-toolchain.toml`) |
| Solana CLI | 2.x |
| Anchor CLI | 0.32.1 |
| Node.js | 18+ |
| pnpm | 9+ |

Install Anchor CLI:

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.32.1
avm use 0.32.1
```

---

## Setup

```bash
# Clone and install dependencies
git clone <repo-url>
cd crowdfunding
pnpm install

# Verify Solana wallet exists (used as payer in tests)
solana-keygen pubkey ~/.config/solana/id.json
# If it doesn't exist yet:
solana-keygen new --outfile ~/.config/solana/id.json
```

---

## Build

```bash
anchor build
```

This compiles the Rust program and generates:
- `target/idl/crowdfunding.json` — the program's IDL
- `target/types/crowdfunding.d.ts` — TypeScript types for the client

---

## Test

Tests require a local Solana validator. Anchor handles this automatically:

```bash
# Build, deploy to local validator, and run all tests
anchor test

# Run tests against an already-running validator (faster iteration)
anchor test --skip-deploy

# Run a single test file
pnpm ts-mocha -p ./tsconfig.json -t 1000000 "tests/create_campaign.t.ts"
```

---

## Deployment

### Localnet

```bash
# Start a local validator in one terminal
solana-test-validator

# Deploy in another terminal
anchor deploy --provider.cluster localnet
```

### Devnet

```bash
# Switch CLI to devnet and airdrop SOL for fees
solana config set --url devnet
solana airdrop 2

anchor deploy --provider.cluster devnet
```

After deployment, update the program ID in `declare_id!` inside `programs/crowdfunding/src/lib.rs` and in `Anchor.toml` if it changes.

---

## Program Architecture

```
programs/crowdfunding/src/
├── lib.rs                   # declare_id!, #[program] entrypoints
├── errors.rs                # Custom error enum
├── events.rs                # On-chain events emitted by each instruction
├── state/
│   ├── campaign.rs          # CampaignRegistry + Campaign account structs
│   └── contribution.rs      # Contribution account struct
└── instructions/
    ├── create_campaign.rs   # Create a new campaign
    ├── contribute.rs        # Contribute SOL to a campaign
    ├── withdraw.rs          # Creator withdraws after successful campaign
    └── refund.rs            # Contributor claims refund after failed campaign
```

### Accounts

| Account | PDA Seeds | Description |
|---|---|---|
| `CampaignRegistry` | `["registry"]` | Global counter that issues sequential campaign IDs |
| `Campaign` | `["campaign", id.to_le_bytes()]` | One account per campaign |
| `Vault` | `["vault", campaign]` | System-owned PDA that holds the campaign's SOL |
| `Contribution` | `["contribution", campaign, contributor]` | Per-(campaign, contributor) deposit record |

### Data Flow

```
[create_campaign] ──► CampaignRegistry.count++
                  ──► Campaign PDA initialized

[contribute]      ──► SOL ──► Vault PDA
                  ──► Campaign.raised += amount
                  ──► Contribution PDA created or updated

         goal reached + deadline passed     goal NOT reached + deadline passed
                  │                                        │
                  ▼                                        ▼
           [withdraw]                               [refund]
     SOL ──► creator wallet               SOL ──► contributor wallet
     Campaign.claimed = true              Contribution PDA closed (rent returned)
```

---

## Instructions

### `create_campaign`

Creates a new campaign and assigns it a sequential ID.

| Parameter | Type | Description |
|---|---|---|
| `title` | `String` | Campaign title, max 50 characters |
| `description` | `String` | Campaign description, max 200 characters |
| `goal` | `u64` | Target amount in lamports |
| `deadline` | `i64` | Unix timestamp when the campaign ends |

```typescript
const id = await nextCampaignId(program);
const campaignPda = getCampaignPda(program.programId, id);

await program.methods
  .createCampaign("Build a school", "Raising funds for a rural school", new BN(10_000_000_000), new BN(deadline))
  .accountsPartial({ creator: wallet.publicKey, campaign: campaignPda })
  .rpc();
```

Emits: `CampaignCreated { id, creator, title, description, goal, deadline }`

---

### `contribute`

Transfers SOL from the contributor into the campaign vault.

| Parameter | Type | Description |
|---|---|---|
| `amount` | `u64` | Lamports to contribute |

```typescript
await program.methods
  .contribute(new BN(1_000_000_000))
  .accounts({ campaign: campaignPda, contributor: wallet.publicKey })
  .rpc();
```

Emits: `Contributed { campaign, contributor, amount, total_raised }`

---

### `withdraw`

Transfers all vault funds to the campaign creator. Only callable after the deadline has passed **and** the goal has been reached.

```typescript
await program.methods
  .withdraw()
  .accountsPartial({ campaign: campaignPda, creator: creator.publicKey })
  .signers([creator])
  .rpc();
```

Emits: `Withdrawn { campaign, creator, amount }`

---

### `refund`

Returns a contributor's deposited SOL when the campaign fails (deadline passed, goal not reached). Closes the `Contribution` account and returns its rent to the contributor.

```typescript
await program.methods
  .refund()
  .accounts({ campaign: campaignPda, contributor: wallet.publicKey })
  .rpc();
```

Emits: `Refunded { campaign, contributor, amount }`

---

## Error Reference

| Code | Name | Message |
|---|---|---|
| 6000 | `ZeroGoal` | Campaign goal must be greater than zero |
| 6001 | `DeadlineInPast` | Deadline must be in the future |
| 6002 | `ZeroAmount` | Contribution amount must be greater than zero |
| 6003 | `CampaignEnded` | Campaign has already ended |
| 6004 | `DeadlineNotReached` | Campaign deadline has not been reached yet |
| 6005 | `GoalNotReached` | Campaign has not reached its goal |
| 6006 | `AlreadyClaimed` | Funds have already been withdrawn |
| 6007 | `Unauthorized` | Only the campaign creator can withdraw |
| 6008 | `GoalReached` | Campaign goal was reached; refunds are not available |
| 6009 | `NothingToRefund` | No contribution found to refund |
| 6010 | `Overflow` | Arithmetic overflow |
| 6011 | `TitleTooLong` | Title exceeds maximum length of 50 characters |
| 6012 | `DescTooLong` | Description exceeds maximum length of 200 characters |

---

## Events

Subscribe to program events in the client using `program.addEventListener`:

```typescript
program.addEventListener("contributed", (event) => {
  console.log(`${event.contributor} contributed ${event.amount} lamports`);
  console.log(`Campaign total: ${event.totalRaised} lamports`);
});
```

| Event | Fields |
|---|---|
| `CampaignCreated` | `id, creator, title, description, goal, deadline` |
| `Contributed` | `campaign, contributor, amount, total_raised` |
| `Withdrawn` | `campaign, creator, amount` |
| `Refunded` | `campaign, contributor, amount` |

---

## Security Notes

- **CEI pattern** enforced in all handlers — state is mutated before any CPI to prevent reentrancy.
- **`has_one = creator`** on `withdraw` — only the original campaign creator can sign.
- **PDA seeds validated** by Anchor on every instruction — account spoofing is not possible.
- **`campaign.claimed` flag** set before the vault transfer in `withdraw` — prevents double-withdrawal.
- **`close = contributor`** on `Contribution` in `refund` — rent is reclaimed and the account cannot be reused after a refund.
- **Checked arithmetic** (`checked_add`) on all lamport accumulations — overflows are caught and rejected.
