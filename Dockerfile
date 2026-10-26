FROM node:24-alpine

ENV TZ="Europe/Helsinki"

WORKDIR /opt/app-root/src

COPY ./.npmrc .
COPY package* ./
RUN npm ci -f --omit-dev --ignore-scripts
COPY . .

EXPOSE 3003

CMD ["npm", "run", "start:prod"]
