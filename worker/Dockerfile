FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY worker ./worker
COPY web ./web
COPY cli ./cli
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tokenarena/web exec prisma generate
RUN pnpm --filter @tokenarena/worker build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY worker ./worker
COPY web ./web
COPY cli ./cli
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/worker/dist ./worker/dist
CMD ["node", "worker/dist/index.js"]
