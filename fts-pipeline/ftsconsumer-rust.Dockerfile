FROM --platform=linux/amd64 rust:1.85-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

COPY ftsconsumer-rust/Cargo.toml ./ftsconsumer-rust/Cargo.toml
COPY ftsconsumer-rust/build.rs ./ftsconsumer-rust/build.rs
COPY ftsconsumer-rust/src ./ftsconsumer-rust/src
COPY proto ./proto

WORKDIR /app/ftsconsumer-rust
RUN cargo build --release

FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/ftsconsumer-rust/target/release/ftsconsumer /usr/local/bin/ftsconsumer

USER nobody

EXPOSE 50061

CMD ["ftsconsumer"]
