# Stage 1: Build the Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# sandbox | development | production — selects .env.[mode] or CI-written env file
ARG BUILD_MODE=production

ARG VITE_TRANSLATION_API_ORIGIN
ARG VITE_SALES_API_ORIGIN
ARG VITE_TRANSLATION_CLOUD_RUN_URL
ARG VITE_SALES_CLOUD_RUN_URL
ARG VITE_CONTRACTS_API_BASE
ARG VITE_GCP_PROJECT_ID
ARG VITE_GCP_PROJECT_NUMBER
ARG VITE_GCP_REGION
ARG VITE_TLS_CA_FILE=certs/colt-internal-ca.pem

ENV VITE_TRANSLATION_API_ORIGIN=$VITE_TRANSLATION_API_ORIGIN
ENV VITE_SALES_API_ORIGIN=$VITE_SALES_API_ORIGIN
ENV VITE_TRANSLATION_CLOUD_RUN_URL=$VITE_TRANSLATION_CLOUD_RUN_URL
ENV VITE_SALES_CLOUD_RUN_URL=$VITE_SALES_CLOUD_RUN_URL
ENV VITE_CONTRACTS_API_BASE=$VITE_CONTRACTS_API_BASE
ENV VITE_GCP_PROJECT_ID=$VITE_GCP_PROJECT_ID
ENV VITE_GCP_PROJECT_NUMBER=$VITE_GCP_PROJECT_NUMBER
ENV VITE_GCP_REGION=$VITE_GCP_REGION
ENV VITE_TLS_CA_FILE=$VITE_TLS_CA_FILE

COPY package*.json ./
RUN npm ci

COPY . .

# Prefer committed .env.[mode]; otherwise write from Docker build args (CI)
RUN if [ ! -f ".env.${BUILD_MODE}" ] && [ -n "${VITE_TRANSLATION_API_ORIGIN}" ]; then \
      printf '%s\n' \
        "VITE_TRANSLATION_API_ORIGIN=${VITE_TRANSLATION_API_ORIGIN}" \
        "VITE_SALES_API_ORIGIN=${VITE_SALES_API_ORIGIN}" \
        "VITE_TRANSLATION_CLOUD_RUN_URL=${VITE_TRANSLATION_CLOUD_RUN_URL}" \
        "VITE_SALES_CLOUD_RUN_URL=${VITE_SALES_CLOUD_RUN_URL}" \
        "VITE_CONTRACTS_API_BASE=${VITE_CONTRACTS_API_BASE}" \
        "VITE_GCP_PROJECT_ID=${VITE_GCP_PROJECT_ID}" \
        "VITE_GCP_PROJECT_NUMBER=${VITE_GCP_PROJECT_NUMBER}" \
        "VITE_GCP_REGION=${VITE_GCP_REGION}" \
        "VITE_TLS_CA_FILE=${VITE_TLS_CA_FILE}" \
        > ".env.${BUILD_MODE}"; \
    fi

RUN npm run build -- --mode "${BUILD_MODE}"
RUN node scripts/generate-nginx-config.mjs

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/nginx/default.conf /etc/nginx/conf.d/default.conf

# Colt internal CA for TLS to internal *.colt.net upstreams
COPY certs/colt-internal-ca.pem /etc/nginx/certs/colt-internal-ca.pem

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
