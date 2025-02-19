FROM node:22

ENV TZ="Europe/Helsinki"

WORKDIR /usr/src/app

COPY package* ./
RUN npm i

EXPOSE 3003

CMD ["npm", "run", "start:dev"]
