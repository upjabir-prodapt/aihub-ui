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
    location /api/metadata/id-token {\n\
        proxy_pass http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/identity;\n\
        proxy_set_header Metadata-Flavor Google;\n\
    }\n\
    location /api/v1/ {\n\
        proxy_pass https://translation.aicoesandox-int.colt.net/api/v1/;\n\
        proxy_ssl_server_name on;\n\
        proxy_set_header Host translation.aicoesandox-int.colt.net;\n\
        proxy_pass_request_headers on;\n\
        proxy_set_header Authorization $http_authorization;\n\
        proxy_set_header x-app-auth $http_x_app_auth;\n\
        proxy_set_header X-Serverless-Authorization $http_authorization;\n\
    }\n\
    location /api/sales/v1/ {\n\
        proxy_pass https://salesagent.aicoesandox-int.colt.net/api/v1/;\n\
        proxy_ssl_server_name on;\n\
        proxy_set_header Host salesagent.aicoesandox-int.colt.net;\n\
        proxy_pass_request_headers on;\n\
        proxy_set_header Authorization $http_authorization;\n\
        proxy_set_header x-app-auth $http_x_app_auth;\n\
        proxy_set_header X-Serverless-Authorization $http_authorization;\n\
    }\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html index.htm;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
