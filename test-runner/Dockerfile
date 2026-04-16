FROM node:20-alpine

# git is required to clone repos; openssh-client for SSH fallback
RUN apk add --no-cache git openssh-client

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 4000

CMD ["node", "dist/index.js"]
