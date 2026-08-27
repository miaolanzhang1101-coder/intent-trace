FROM oven/bun:1

WORKDIR /app

COPY package.json package-lock.json ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

ENV NODE_ENV=production

CMD ["bun", "run", "server/index.js"]
