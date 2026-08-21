FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3002
# Roda as migrations pendentes (idempotente - so aplica o que falta) antes de
# subir a API. Garante que redeploy nunca sobe com schema desatualizado/vazio,
# sem depender de alguem entrar no container e rodar migration:run:prod a mao.
CMD ["sh", "-c", "npm run migration:run:prod && node dist/main"]
