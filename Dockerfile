FROM oven/bun:1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN bun run build

ENV NODE_ENV=production

CMD ["bun", "run", "server/index.js"]
