FROM node:18-alpine as builder
WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/*/package.json ./packages/*/
COPY apps/tier-2-10k/package.json ./apps/tier-2-10k/

RUN pnpm install

COPY packages/ ./packages/
COPY apps/tier-2-10k/ ./apps/tier-2-10k/

WORKDIR /app/apps/tier-2-10k
RUN pnpm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder app/node_modules ./node_modules
COPY --from=builder app/apps/tier-2-10k/dist ./apps/tier-2-10k/dist
COPY --from=builder app/apps/tier-2-10k/node_modules ./apps/tier-2-10k/node_modules
WORKDIR /app/apps/tier-2-10k

CMD [ "node", "dist/apps/tier-2-10k/src/server.js"]
