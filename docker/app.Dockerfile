ARG NODE_VERSION=20.20.0-slim
FROM node:${NODE_VERSION} AS base

ARG PNPM_VERSION=10.11.0
ARG GOGCLI_VERSION=v0.15.0

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm --version

RUN set -eux; \
  GOGCLI_VERSION_NO_V="${GOGCLI_VERSION#v}"; \
  curl -fsSL "https://github.com/openclaw/gogcli/releases/download/${GOGCLI_VERSION}/gogcli_${GOGCLI_VERSION_NO_V}_linux_amd64.tar.gz" -o /tmp/gogcli.tar.gz; \
  mkdir -p /tmp/gogcli; \
  tar -xzf /tmp/gogcli.tar.gz -C /tmp/gogcli; \
  install -m 0755 "$(find /tmp/gogcli -type f -name gog | head -n 1)" /usr/local/bin/gog; \
  gog --version; \
  rm -rf /tmp/gogcli /tmp/gogcli.tar.gz

WORKDIR /app

FROM base AS build

ARG NEXT_PUBLIC_API_URL=/api
ARG RYANOS_INTERNAL_API_URL=http://api:4000

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV RYANOS_INTERNAL_API_URL=${RYANOS_INTERNAL_API_URL}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter './packages/*' build
RUN pnpm --filter @ryanos/api build
RUN pnpm --filter @ryanos/worker build
RUN pnpm --filter @ryanos/ai build
RUN pnpm --filter @ryanos/web build

FROM base AS runtime

ENV CI=true
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app /app

EXPOSE 3000 4000

CMD ["node", "apps/api/dist/index.js"]
