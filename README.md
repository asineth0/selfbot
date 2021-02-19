# Selfbot

Lightweight & configurable bot for Discord user accounts.

## Features

- Not reliant upon Discord.js (they killed selfbot support).
- Uses zlib for compression during gatway communication.
- Uses more efficient ETF instead of JSON for gateway communication.
- Multiple accounts support with per-account configuration in JSON.
- Message, presence, typing and voice events logging.
- Attachment saving and dedpulcation.
- Commands for deleting messages.
- Commands for exporting channel history.
- Macros for popular Discord bots (SlotBot, etc).

## Configuration

1. Create a copy of the configuration.

```sh
cp config{.example,}.json
```

2. Add your accounts and configure the bot.

```sh
nano config.json
```

## Deployment

### Using Docker (recommended)

- [Docker](https://docs.docker.com/get-docker/) must be installed.
- [Docker Compose](https://docs.docker.com/compose/install/) must be installed.

```sh
docker-compose up -d --build
```

### Without containers

- [Node.js](https://nodejs.org/en/download/) 12.x or newer must be installed.
- [Yarn](https://classic.yarnpkg.com/en/docs/install/) must be installed.

Make sure both are accessible and executable from your PATH.

```sh
yarn
yarn start
```

## Commands

- `?d, ?delete <limit>`

Deletes `<limit>` messages from the channel.

- `?c, ?clear`

Deletes all deletable messages from the channel.

- `?e, ?export`

Export all messages & attachments from the channel.
