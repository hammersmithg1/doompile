FROM node:22.18.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
ARG DOOMPILE_BUILD_COMMIT=development
ENV DOOMPILE_BUILD_COMMIT=$DOOMPILE_BUILD_COMMIT
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.18.0-bookworm-slim AS runtime
ARG DOOMPILE_BUILD_COMMIT=development
ENV DOOMPILE_BUILD_COMMIT=$DOOMPILE_BUILD_COMMIT
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DOOMPILE_DATA_DIR=/data
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/infra/backup.mjs /app/infra/restore-s3.mjs /app/infra/verify-backup.mjs ./infra/
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/web
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
