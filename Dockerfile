FROM node:lts
WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN yarn
COPY . .
CMD ["yarn", "start"]