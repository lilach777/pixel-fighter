# Single-service image: game server + built frontend on one origin (HTTPS/WSS via your host).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# This image runs the game server, so the frontend uses it instead of peer-to-peer.
ENV VITE_ONLINE_MODE=server
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
ENV PORT=8787 SERVE_CLIENT=true
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "server/dist/index.js"]
