# Stage 1: Build the Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:alpine

# Copy the built files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Configure Nginx to listen on port 8080 and support SPA routing
RUN printf 'server {\n\
    listen 8080;\n\
    server_name localhost;\n\
    resolver 8.8.8.8 8.8.4.4 valid=30s;\n\
    resolver_timeout 5s;\n\
    location /api/metadata/id-token {\n\
        proxy_pass http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/identity;\n\
        proxy_set_header Metadata-Flavor Google;\n\
    }\n\
    location /api/v1/ {\n\
        set $translation_backend https://translation-api-service-297743845367.europe-west1.run.app;\n\
        proxy_pass $translation_backend;\n\
        proxy_ssl_server_name on;\n\
        proxy_set_header Host translation-api-service-297743845367.europe-west1.run.app;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_pass_request_headers on;\n\
    }\n\
    location /sales-api/ {\n\
        rewrite ^/sales-api(/.*)$ $1 break;\n\
        set $sales_backend https://sales-research-application-297743845367.europe-west1.run.app;\n\
        proxy_pass $sales_backend;\n\
        proxy_ssl_server_name on;\n\
        proxy_set_header Host sales-research-application-297743845367.europe-west1.run.app;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_pass_request_headers on;\n\
    }\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html index.htm;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
