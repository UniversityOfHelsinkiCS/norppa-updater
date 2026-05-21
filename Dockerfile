FROM registry.access.redhat.com/ubi8/nodejs-16-minimal

ENV TZ="Europe/Helsinki"

WORKDIR /opt/app-root/src

RUN curl -fsSL https://github.com/AikidoSec/safe-chain/releases/latest/download/install-safe-chain.sh | sh -s -- --ci
COPY package* ./
RUN npm ci -f --omit-dev --ignore-scripts
COPY . .

EXPOSE 3003

CMD ["npm", "run", "start:prod"]
