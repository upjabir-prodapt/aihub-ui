# Build from this folder:
#   docker build -t naas-frontend .
FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# VITE_AGENT_BACKEND_URL is read via import.meta.env at BUILD time (Vite
# inlines it into the compiled JS) -- unlike the two Python services'
# config, this can't be supplied as a plain runtime `docker run -e`; it
# has to be set before `npm run build` runs. Defaults to the real
# deployed agent-backend so a plain `docker build` with no --build-arg
# already produces a working image; override with
# --build-arg VITE_AGENT_BACKEND_URL=... to point at a different backend.
ARG VITE_AGENT_BACKEND_URL=https://naas-agent-backend-297743845367.europe-west1.run.app
ENV VITE_AGENT_BACKEND_URL=$VITE_AGENT_BACKEND_URL
RUN npm run build

# Serves the built dist/ via Vite's own preview server rather than
# introducing a separate nginx config -- keeps this to tooling already in
# package.json. For a real production deployment, swapping this stage
# for nginx (or another static file server) serving dist/ directly is a
# reasonable follow-up, just not required for this to work.
FROM node:20-slim

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Vite's preview server defaults to binding localhost only -- --host
# makes it reachable from outside the container. Deployed at:
#   https://naas-agent-frontend-297743845367.europe-west1.run.app
# (allow-listed in vite.config.ts's preview.allowedHosts, and matching
# agent-backend's FRONTEND_ORIGIN for CORS).
EXPOSE 4173

# Cloud Run injects its own $PORT (default 8080) and requires the
# container to listen on it, not a hardcoded 4173.
CMD ["sh", "-c", "npm run preview -- --host 0.0.0.0 --port ${PORT:-4173}"]
