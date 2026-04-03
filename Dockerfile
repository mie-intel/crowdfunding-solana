# Use the official Rust image with version 1.92
FROM rust:1.92-bookworm

# Install system dependencies needed for Anchor/Solana
RUN apt-get update && apt-get install -y \
    pkg-config \
    libudev-dev \
    libssl-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Anchor CLI 1.0.0
# The --locked flag ensures it uses the versions specified in the Anchor repo
RUN cargo install --force --version 1.0.0 anchor-cli --locked

WORKDIR /build