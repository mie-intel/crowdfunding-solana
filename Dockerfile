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

# 2. Install Solana CLI (Latest stable as of 2026)
# This provides 'cargo-build-sbf'
RUN sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# 3. Set Environment Path for Solana
# Adjust 'active_release' if you need a specific version pinning
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

# 4. Install Anchor CLI 1.0.0
# Using --locked is good practice to ensure dependency stability
RUN cargo install --force --version 1.0.0 anchor-cli --locked

WORKDIR /build