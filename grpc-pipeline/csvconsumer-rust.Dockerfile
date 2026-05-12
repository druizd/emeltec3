FROM --platform=linux/amd64 rust:1.85-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

COPY proto ./proto
COPY csvconsumer-rust/Cargo.toml ./csvconsumer-rust/Cargo.toml
COPY csvconsumer-rust/build.rs ./csvconsumer-rust/build.rs
COPY csvconsumer-rust/src ./csvconsumer-rust/src

WORKDIR /app/csvconsumer-rust
RUN cargo build --release

FROM --platform=linux/amd64 debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/csvconsumer-rust/target/release/csvconsumer /usr/local/bin/csvconsumer

EXPOSE 50051

CMD ["csvconsumer"]
