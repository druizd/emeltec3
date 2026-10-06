FROM --platform=linux/amd64 rust:1.90-bookworm AS builder

WORKDIR /app

# El Cargo.lock fija las versiones que siguen siendo validas. Sin --locked:
# el lock esta desfasado del Cargo.toml y cargo debe poder completarlo.
# ctutils 0.4.3 exige rustc >= 1.87, de ahi la imagen 1.90.
COPY Cargo.toml Cargo.lock ./
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
