FROM --platform=linux/amd64 rust:1.85-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

COPY ftpconsumer-rust/Cargo.toml ./ftpconsumer-rust/Cargo.toml
COPY ftpconsumer-rust/build.rs ./ftpconsumer-rust/build.rs
COPY ftpconsumer-rust/src ./ftpconsumer-rust/src
COPY proto ./proto

WORKDIR /app/ftpconsumer-rust
RUN cargo build --release

FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/ftpconsumer-rust/target/release/ftpconsumer /usr/local/bin/ftpconsumer

USER nobody

EXPOSE 50061

CMD ["ftpconsumer"]
