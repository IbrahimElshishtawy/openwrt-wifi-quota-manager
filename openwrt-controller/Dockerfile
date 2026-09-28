# ==============================================================================
# OpenWrt Controller - Multi-stage Production Dockerfile
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Stage
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDependencies required for tsc)
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Copy TypeScript source code and build
COPY src/ ./src
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Install openssh-client so controller can interact with OpenWrt (nlbwmon, nftables)
RUN apk add --no-cache openssh-client

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript bundle from builder stage
COPY --from=builder /app/dist ./dist

# Create runtime directories for data persistence and SSH credentials with strict permissions
RUN mkdir -p /app/data /home/node/.ssh && \
    chown -R node:node /app /home/node/.ssh && \
    chmod 700 /home/node/.ssh

# Run as non-root user
USER node

# Expose controller HTTP port
EXPOSE 3000

# Container liveness health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the compiled Fastify controller server
CMD ["node", "dist/server.js"]
