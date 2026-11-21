FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY api ./api
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8091
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --chown=node:node package.json ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8091/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/local-http.js"]
