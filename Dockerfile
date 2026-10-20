# Один контейнер: Fastify API + собранный фронт (SPA) на одном порту.
# Подходит для Railway и Render (оба собирают Dockerfile из репозитория).

FROM node:22-bookworm-slim AS build
# openssl нужен Prisma, ca-certificates — для запросов к Apple/Google
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001
# Миграции применяются при каждом старте (идемпотентно), затем запуск сервера
CMD ["pnpm", "start:prod"]
