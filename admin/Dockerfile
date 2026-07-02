# Admin portal image (Railway, second service). Build context = repo root.
FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN npm install
RUN npm run build -w @app/shared && npm run build -w @app/admin

FROM node:22-slim AS run
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@app/admin"]
