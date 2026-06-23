FROM node:22-bookworm

WORKDIR /app
ENV NODE_ENV=production

# Offline-friendly image: build the monorepo on the host first, then copy the compiled
# artifacts and installed node_modules into the image. This avoids leaking .env files
# and keeps Docker builds working even when the Docker builder has restricted DNS.
COPY package.json pnpm-workspace.yaml ./
COPY migrations ./migrations
COPY node_modules ./node_modules
COPY server/package.json ./server/package.json
COPY server/node_modules ./server/node_modules
COPY server/dist ./server/dist
COPY shared/package.json ./shared/package.json
COPY shared/node_modules ./shared/node_modules
COPY shared/dist ./shared/dist
COPY web/dist ./web/dist

# Rebuild native SQLite bindings inside the image so they match the container Node runtime.
RUN cd server && npm_config_nodedir=/usr/local npm rebuild better-sqlite3 --build-from-source

EXPOSE 3333

CMD ["node", "server/dist/index.js"]
