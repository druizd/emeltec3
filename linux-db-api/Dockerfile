FROM --platform=linux/amd64 rust:1.85-bookworm AS builder

WORKDIR /app

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

FROM --platform=linux/amd64 debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/linux-db-api /usr/local/bin/linux-db-api

USER nobody

EXPOSE 3010

CMD ["linux-db-api"]
