FROM oven/bun:1.3
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN mkdir -p /app/out && chown -R bun:bun /app

ENV NODE_ENV=production
USER bun
EXPOSE 3000
CMD ["bun", "src/server.ts"]
