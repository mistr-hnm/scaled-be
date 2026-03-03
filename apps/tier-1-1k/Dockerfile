FROM node:18-alpine as builder

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/*/package.json ./packages/*/
COPY apps/tier-1-1k/package.json ./apps/tier-1-1k/package.json

RUN pnpm install

COPY packages/       ./packages/
COPY apps/tier-1-1k/ ./apps/tier-1-1k/
WORKDIR /app/apps/tier-1-1k/
RUN pnpm run build


FROM node:18-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/tier-1-1k/dist ./apps/tier-1-1k/dist
COPY --from=builder /app/apps/tier-1-1k/node_modules ./apps/tier-1-1k/node_modules

WORKDIR /app/apps/tier-1-1k

CMD [ "node", "dist/apps/tier-1-1k/src/server.js"]