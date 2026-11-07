# MinIO's patched community release is distributed as source.
FROM golang:1.25-bookworm AS builder
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN CGO_ENABLED=0 GOMAXPROCS=2 GOBIN=/out go install github.com/minio/minio@${MINIO_VERSION}
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && mkdir /data && chown 1000:1000 /data
COPY --from=builder /out/minio /usr/local/bin/minio
USER 1000:1000
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
