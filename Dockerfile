# Build en tres etapas: frontend -> binario Go con el frontend embebido ->
# imagen minima. El resultado corre como no-root y no necesita nada del SO
# (tzdata y CA certs vienen embebidos/incluidos).

# --- 1. Frontend -------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- 2. Backend --------------------------------------------------------------
FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /app/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/acapelius ./cmd/server

# --- 3. Runtime --------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/acapelius /acapelius
EXPOSE 8080
ENTRYPOINT ["/acapelius"]
