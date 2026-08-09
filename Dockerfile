# node:sqlite is used without --experimental-sqlite, which needs a Node
# version at least as new as the one this app was developed/tested against
# (v25.x) - don't downgrade this without confirming node:sqlite still works
# flag-free on whatever version you pick.
FROM node:25-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY client/package*.json client/
RUN npm ci && npm --prefix client ci

COPY . .
RUN npm run build

FROM node:25-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist
COPY config.json ./
COPY FAQ.md ./
COPY STOCKS.md ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
