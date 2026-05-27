ARG NODE_VERSION=20.20.0-slim
FROM node:${NODE_VERSION}

ARG PNPM_VERSION=10.11.0

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@${PNPM_VERSION} \
  && pnpm --version

WORKDIR /app

EXPOSE 3000 4000

CMD ["node"]
