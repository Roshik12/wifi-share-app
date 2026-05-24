FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3000

CMD ["npm", "start"]
