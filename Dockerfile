# ─── Base ───────────────────────────────────────────────────
# Debian slim (glibc) — reliable prebuilt native modules (argon2) & Prisma engines.
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl dumb-init ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ─── Dependencies (prod only; includes prisma CLI for migrate deploy) ───
FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# ─── Runtime ────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p storage/uploads && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
