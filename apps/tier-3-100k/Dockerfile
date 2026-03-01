FROM node:18 as build

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/*/package.json ./packages/*/
COPY apps/tier-3-100k/package.json ./apps/tier-3-100k/

RUN pnpm install

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/tier-3-100k ./apps/tier-3-100k

WORKDIR /app/apps/tier-3-100k
RUN pnpm run build


FROM node:18 
RUN corepack enable
WORKDIR /app

COPY --from=build app/node_modules ./node_modules
COPY --from=build app/apps/tier-3-100k/dist ./apps/tier-3-100k/dist
COPY --from=build app/apps/tier-3-100k/node_modules ./apps/tier-3-100k/node_modules

WORKDIR /app/apps/tier-3-100k

CMD [ "node" , "dist/apps/tier-3-100k/src/server.js"]