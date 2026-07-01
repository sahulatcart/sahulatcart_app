# Backend service image (Railway). Builds the workspace-shared package too.
FROM node:20-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
RUN npm install
COPY shared/ shared/
COPY backend/ backend/
RUN npm run build -w @app/shared && npm run build -w @app/backend

FROM node:20-slim AS run
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/shared/dist ./shared/dist
COPY --from=build /repo/shared/package.json ./shared/package.json
COPY --from=build /repo/backend/dist ./backend/dist
COPY --from=build /repo/backend/package.json ./backend/package.json
COPY package.json ./
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
