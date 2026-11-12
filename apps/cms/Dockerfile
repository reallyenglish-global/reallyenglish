FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY apps/cms/package.json apps/cms/package-lock.json ./
RUN npm ci
COPY apps/cms/ .
RUN npm run build && npm prune --omit=dev
RUN mkdir -p /app/.tmp /app/public/uploads && chown -R node:node /app

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=1337 DATABASE_CLIENT=sqlite DATABASE_FILENAME=.tmp/data.db
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 1337
CMD ["npm", "run", "start"]
