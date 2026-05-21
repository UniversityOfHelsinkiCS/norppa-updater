FROM node:18

ENV TZ="Europe/Helsinki"

WORKDIR /usr/src/app

RUN curl -fsSL https://github.com/AikidoSec/safe-chain/releases/latest/download/install-safe-chain.sh | sh -s -- --ci
COPY package* ./
RUN npm ci

EXPOSE 3003

CMD ["npm", "run", "start:dev"]
