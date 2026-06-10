FROM node:26-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY worker ./worker
COPY web ./web
# Approve build scripts for native dependencies and install
RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --frozen-lockfile
RUN pnpm --filter @tokenarena/web exec prisma generate
RUN pnpm --filter @tokenarena/worker build

FROM node:26-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY worker ./worker
COPY web ./web
# Approve build scripts for native dependencies and install production-only deps
RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/worker/dist ./worker/dist
COPY --from=builder /app/web/generated ./web/generated
CMD ["node", "worker/dist/index.js"]
