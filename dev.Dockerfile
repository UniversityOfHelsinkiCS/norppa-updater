FROM node:24

ENV TZ="Europe/Helsinki"

WORKDIR /usr/src/app

COPY ./.npmrc .
COPY package* ./
RUN npm ci

EXPOSE 3003

CMD ["npm", "run", "start:dev"]
