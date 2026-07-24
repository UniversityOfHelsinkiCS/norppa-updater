FROM registry.access.redhat.com/ubi9/nodejs-24-minimal

ENV TZ="Europe/Helsinki"

WORKDIR /opt/app-root/src

COPY ./.npmrc .
COPY package* ./
RUN npm ci -f --omit-dev --ignore-scripts
COPY . .

EXPOSE 3003

CMD ["npm", "run", "start:prod"]
