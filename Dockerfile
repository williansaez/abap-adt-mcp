# --- build stage --------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- runtime stage ------------------------------------------------------------
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json server.json ./
# Run unprivileged. Mount your systems.json read-only and point SAP_SYSTEMS_FILE at it:
#   docker run -i -v $PWD/systems.json:/config/systems.json:ro -e SAP_SYSTEMS_FILE=/config/systems.json ghcr.io/williansaez/abap-adt-mcp
# stdio is the default transport. For Streamable HTTP inside a container set
# MCP_HTTP_PORT and MCP_HTTP_HOST=0.0.0.0 (the default bind is loopback) and
# publish the port; the bearer token is still required.
USER node
ENTRYPOINT ["node", "./dist/index.js"]
