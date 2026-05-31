FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY backend ./backend
COPY frontend ./frontend
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=4173

EXPOSE 4173

CMD ["node", "backend/server.js"]
