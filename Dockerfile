# Use Rust 1.92 as requested
FROM rust:1.92-bookworm

# 1. Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libudev-dev \
    libssl-dev \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Solana CLI v3.1.12
# This provides 'cargo-build-sbf'
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v3.1.12/install)"

# 3. Set Environment Path for Solana
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# 4. Install Anchor CLI 0.32.1
# Using --locked is good practice to ensure dependency stability
RUN cargo install --force --version 0.32.1 anchor-cli --locked

WORKDIR /build
