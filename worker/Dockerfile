FROM node:26-alpine AS builder
WORKDIR /app

# Install pnpm (pinned to match dev environment)
RUN npm install -g pnpm@10.32.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY worker ./worker
COPY web ./web

RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @tokenarena/web exec prisma generate
RUN pnpm --filter @tokenarena/worker build

FROM node:26-alpine
WORKDIR /app

# Install pnpm (pinned to match dev environment)
RUN npm install -g pnpm@10.32.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY worker ./worker
COPY web ./web

RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/worker/dist ./worker/dist
COPY --from=builder /app/web/generated ./web/generated
CMD ["node", "worker/dist/index.js"]
