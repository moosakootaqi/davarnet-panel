FROM node:20-alpine

RUN apk add --no-cache curl unzip

WORKDIR /app

RUN curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip && \
    mkdir -p /usr/local/bin/xray-core && \
    unzip xray.zip -d /usr/local/bin/xray-core && \
    rm xray.zip && \
    chmod +x /usr/local/bin/xray-core/xray

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public ./public

EXPOSE 3000 8443

CMD ["node", "server.js"]
