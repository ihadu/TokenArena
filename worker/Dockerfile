FROM node:26-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm@10.32.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY web/prisma ./web/prisma/
COPY worker/package.json ./worker/

# Approve build scripts and install filtered to web+worker (skips root husky prepare)
RUN printf 'onlyBuiltDependencies[]=@parcel/watcher\nonlyBuiltDependencies[]=@prisma/engines\nonlyBuiltDependencies[]=@swc/core\nonlyBuiltDependencies[]=esbuild\nonlyBuiltDependencies[]=msw\nonlyBuiltDependencies[]=prisma\nonlyBuiltDependencies[]=sharp\n' > .npmrc \
    && pnpm install --filter @tokenarena/web... --filter @tokenarena/worker... --frozen-lockfile

FROM node:26-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@10.32.1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web ./web
COPY worker ./worker

ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

# Generate the Prisma client (writes to web/generated/prisma)
RUN pnpm --filter @tokenarena/web exec prisma generate

# Compile worker TypeScript
RUN pnpm --filter @tokenarena/worker build

FROM node:26-alpine AS runner
WORKDIR /app

# Copy production node_modules from deps (avoids second install / husky prepare)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
COPY web ./web
COPY worker ./worker

# Copy build outputs
COPY --from=builder /app/worker/dist ./worker/dist
COPY --from=builder /app/web/generated ./web/generated

CMD ["node", "worker/dist/index.js"]
