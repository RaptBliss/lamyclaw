FROM oven/bun:1.2.21-alpine
WORKDIR /app

RUN apk add --no-cache docker-cli

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY web ./web
COPY tsconfig.json ./tsconfig.json

EXPOSE 4300
CMD ["bun", "run", "src/index.ts"]
