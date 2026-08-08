# =============================================================================
#  React -> static files -> nginx.
#  No Node runtime in the final image: ~50 MB instead of ~1 GB.
# =============================================================================

FROM node:22.12-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Vite bakes env vars in at BUILD time, not run time. Hence the build arg.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- runtime ------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# Use 127.0.0.1, NOT localhost: inside the container `localhost` resolves to
# ::1 first, and if nginx is only bound to IPv4 the check fails against a
# perfectly healthy server.
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
