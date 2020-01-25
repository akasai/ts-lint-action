FROM node:12-alpine
MAINTAINER akasai

WORKDIR /usr/src/app

COPY package.json /usr/src/app
COPY package-lock.json /usr/src/app
COPY index.ts /usr/src/app
COPY tsconfig.json /usr/src/app

RUN npm ci --production

RUN npm run build

ENTRYPOINT ["npm", "run", "start:prod"]
