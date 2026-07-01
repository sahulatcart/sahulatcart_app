# Backend service image (Railway). Build context = repo root.
FROM node:20-slim AS build
WORKDIR /repo
COPY . .
RUN npm install
RUN npm run build -w @app/shared && npm run build -w @app/backend

FROM node:20-slim AS run
WORKDIR /repo
ENV NODE_ENV=production
# Copy the whole built repo (incl. hoisted + workspace-nested node_modules).
COPY --from=build /repo ./
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
