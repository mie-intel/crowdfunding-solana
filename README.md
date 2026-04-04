# Crowdfunding — Solana / Anchor

A decentralized crowdfunding program built on Solana using the [Anchor](https://www.anchor-lang.com/) framework. Campaigns are created with a fundraising goal and deadline. Contributors send SOL directly into a per-campaign vault PDA. If the goal is met, the creator withdraws. If it is not, every contributor can claim a refund individually.

---

## Prerequisites

| Tool | Version |
|---|---|
| Rust | 1.92.0 (pinned via `rust-toolchain.toml`) |
| Solana CLI | 3.1.11 |
| Anchor CLI | 1.0.0 |
| Node.js | 20+ |
| pnpm | 9+ |

Install Anchor CLI:

```bash
mkdir -p ~/.local/bin
curl -L https://github.com/solana-foundation/anchor/releases/download/v1.0.0/anchor-1.0.0-x86_64-unknown-linux-gnu \
  -o ~/.local/bin/anchor
chmod +x ~/.local/bin/anchor
export PATH="$HOME/.local/bin:$PATH"
```

Install Solana CLI:

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.11/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
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
# Sync program keypair with declare_id! (required after fresh clone or keypair changes)
anchor keys sync

# Compile the program
anchor build
```

This generates:
- `target/idl/crowdfunding.json` — the program's IDL
- `target/types/crowdfunding.d.ts` — TypeScript types for the client
- `target/deploy/crowdfunding.so` — the compiled program binary

---

## Test

```bash
# Build, deploy to local validator, and run all tests
anchor test

# Run tests without rebuilding (faster iteration)
anchor test --skip-build --provider.cluster localnet --validator legacy
```

The `--validator legacy` flag uses `solana-test-validator` as the local validator.

---

## Deployment

### Localnet

**1. Sync program ID with your keypair**
```bash
anchor keys sync
```

**2. Build and deploy**
```bash
anchor build
anchor deploy --provider.cluster localnet
```

**3. Fund your wallet if needed**
```bash
solana airdrop 10 --url localhost
```

**4. Verify**
```bash
solana program show <PROGRAM_ID> --url localhost
```

---

### Devnet

**1. Switch CLI to devnet**
```bash
solana config set --url devnet
```

**2. Fund your wallet**
```bash
solana airdrop 2
# If rate-limited: https://faucet.solana.com
```

**3. Sync program ID and build**
```bash
anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
```

**4. Verify**
```bash
solana program show <PROGRAM_ID> --url devnet
```

> After deployment, if the program ID changes, run `anchor keys sync` to automatically update `declare_id!` in `lib.rs` and `Anchor.toml`.

---

## Deployed Program

| Network | Program ID | Explorer |
|---------|------------|---------|
| Devnet  | `Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S` | [View on Solscan](https://solscan.io/account/Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S) |

---

## Verify Program (Only works on mainnet)

On-chain verification uses a custom Docker image to ensure a reproducible build environment that matches the deployed binary.

**1. Build the custom Docker image** (from the repo root where `Dockerfile` lives):

```bash
docker build -t solana-custom-3.1.12:latest .
```

**2. Build a verifiable binary**

```bash
anchor build --verifiable --base-image solana-custom-3.1.12:latest
```

This produces `target/verifiable/crowdfunding.so` — a reproducibly-built binary tied to the Docker image.

**3. Deploy the verifiable binary**

```bash
solana program deploy target/verifiable/crowdfunding.so \
  --program-id Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S \
  -u m
```

If the deploy fails mid-upload (e.g. due to a network interruption), resume with the buffer address printed in the error output:

```bash
solana program deploy \
  --buffer <buffer> \
  --program-id Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S \
  -u m
```

**4. Run on-chain verification**

```bash
solana-verify verify-from-repo \
  --program-id Ek2bLWaxfc3aY25LL89LCL3aJgHRBhEzvApxYWnErA4S \
  -u mainnet \
  --commit-hash <commit-hash> \
  --base-image solana-custom-3.1.12:latest \
  https://github.com/mie-intel/crowdfunding-solana
```

`solana-verify` builds the program inside the Docker image at the specified commit and compares the resulting binary hash against the on-chain program. A passing result means the deployed bytecode matches this source code exactly.

---

## Smoke Tests

Smoke tests exercise the full happy-path flow (create campaign → contribute → verify state) against a live deployment.

### Localnet

Requires a running local validator and a deployed program.

```bash
anchor build && anchor deploy --provider.cluster localnet
pnpm smoke
```

### Devnet

Uses your main wallet (`~/.config/solana/id.json`) as both creator and contributor. Ensure your wallet has at least 1 SOL before running.

```bash
pnpm smoke:devnet
```

Get devnet SOL at [faucet.solana.com](https://faucet.solana.com) if your balance is low.

---

## Program Architecture

```
programs/crowdfunding/src/
├── lib.rs                   # declare_id!, #[program] entrypoints, security.txt
├── errors.rs                # Custom error enum
├── events.rs                # On-chain events emitted by each instruction
├── state/
│   ├── campaign.rs          # CampaignRegistry + Campaign account structs
│   └── contribution.rs      # Contribution account struct
└── instructions/
    ├── create_campaign.rs   # Create a new campaign
    ├── contribute.rs        # Contribute SOL to a campaign
    ├── withdraw.rs          # Creator withdraws after successful campaign
    ├── refund.rs            # Contributor claims refund after failed campaign
    ├── cancel.rs            # Creator cancels an unfunded campaign
    └── expire.rs            # Close an expired campaign with no contributions

tests/
├── helpers/
│   ├── index.ts             # Re-exports all helpers
│   ├── constants.ts         # Shared test constants (amounts, durations, etc.)
│   ├── pda.ts               # PDA derivation helpers
│   ├── program.ts           # Program client setup
│   └── network.ts           # Network utilities (e.g. advancing clock)
├── create_campaign.t.ts     # Tests for create_campaign instruction
├── contribute.t.ts          # Tests for contribute instruction
├── withdraw.t.ts            # Tests for withdraw instruction
├── refund.t.ts              # Tests for refund instruction
├── cancel.t.ts              # Tests for cancel_campaign instruction
└── expire.t.ts              # Tests for expire_campaign instruction
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
- **`security.txt`** embedded in the program binary — contact info readable on-chain via `solana-security-txt`.
