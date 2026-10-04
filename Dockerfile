# Doggin' Around / Storm Night as a static site behind nginx.
#   docker build -t doggin-around .
#   docker run --rm -p 8080:8080 doggin-around      → http://localhost:8080 (the game), /viewer.html
# Listens on $PORT (default 8080), as Cloud Run, Render, Railway, Fly and friends expect.

# Build: type-check and bundle both pages; the Marble worlds are copied into dist/ (vite.config.ts).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve: just the files, no Node at runtime.
FROM nginx:stable-alpine
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
