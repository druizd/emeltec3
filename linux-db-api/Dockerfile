FROM --platform=linux/amd64 rust:1.85-bookworm AS builder

WORKDIR /app

# Sin el Cargo.lock, cada build resolvia dependencias de cero y una version
# nueva (ctutils 0.4.3, rustc >= 1.87) rompia el build con rust:1.85.
COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release --locked

FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/linux-db-api /usr/local/bin/linux-db-api

USER nobody

EXPOSE 3010

CMD ["linux-db-api"]
