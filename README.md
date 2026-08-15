# hypixel-guild-discord-bridge

<p>
  <a href="https://github.com/plantain-00/type-coverage"><img alt="type-coverage" src="https://img.shields.io/badge/dynamic/json.svg?label=type-coverage&prefix=%E2%89%A5&suffix=%&query=$.typeCoverage.atLeast&uri=https%3A%2F%2Fraw.githubusercontent.com%2Faidn3%2Fhypixel-guild-discord-bridge%2Fmaster%2Fpackage.json"></a>
  <img alt="A badge displaying the number of messages being sent via the project" src="https://img.shields.io/badge/dynamic/json?label=Messages%20Sent&query=totalChatShort&url=https%3A%2F%2Faidn5.com%2Fstats.json">
  <a href="https://discord.gg/ej7tQHPF8y"><img src="https://img.shields.io/discord/1002575659694043206?color=5865F2&logo=discord&logoColor=white" alt="Discord server" /></a>
</p>

## Introduction

A service that connects multiple Hypixel guilds and Discord servers together.
This project is made to be fully flexible and customisable, offering a high quality user experience while keeping it simple.

> **_DISCLAIMER_: This project interacts with Hypixel in an unintended way by simulating a minecraft client and by processing
> packets which might get you banned if over-abused too much.  
> Just like any other modification and service that interacts with Hypixel servers, this goes without saying: "Use at
> your own risk"**

## Documentation And Tutorials

- [All Commands And Interactions](docs/COMMANDS.md)

## Features

- Connect multiple guilds chats together
- Bind hypixel guild chats to Discord channels
- Supports public, officer and private chat
- Supports in-game moderation commands from Discord
- Fully synchronize in-game chat and interactions with Discord including guild events such as
  online/offline/join/leave/mute notification/etc
- Support many commands from fun ones to management ones
- Logs all chats/events/etc as records for staff to view
- Provides detailed metrics per user and per guild (by Prometheus)
- Supports proxies for Minecraft instances

## Installing and Running

### Prerequisites

- [Node.js version 22 or later](https://nodejs.dev/download)
- [npm](https://nodejs.org/en/download/) (usually installed by default with `Nodejs`)
- [Git](https://git-scm.com/downloads)
- Minecraft alt account

### Download

Clone and download the complete project by using `Git` tool:

```shell
git clone https://github.com/aidn3/hypixel-guild-discord-bridge
```

### Configure

- Create/edit `config.yaml` in the project root (see the section below for which keys are bootstrap settings)
- Open `config.yaml` and fill in the information (Security: `config.yaml` contains sensitive information. Keep it safe!)
- In `config.yaml` fill out `general.hypixelApiKey` and `discord.key` and `discord.adminIds` (IDs should be strings; numeric IDs will be coerced to strings)

### config.yaml vs. web dashboard

`config.yaml` only holds **bootstrap** settings that are needed before the database and web server are available:

| Setting | Purpose |
| --- | --- |
| `general.hypixelApiKey` | Hypixel API access |
| `discord.key` | Discord bot token |
| `discord.adminIds` | Admin permission (fallback for web auth) |
| `web.*` | Web server port + `signingSecret` for dashboard auth |
| `prometheus.*` | Metrics endpoint |
| `database.*` | Database connection |

Everything else is managed from the **web dashboard** and stored in the database (no restart required):

- **Bridges are multi-bridge only.** At least one bridge must exist in the database (create it on the `Settings` page) before any Minecraft instance or Discord channel is routed. Instances/channels not assigned to a bridge are ignored with a warning.
- Per-bridge settings (channels, staff roles, chat commands, rankup automation, tournaments, moderation, translations, interviews, stats topics): `Settings` page
- Global API keys (`urchinApiKey`, `openrouterApiKey`, `openrouterModel`): `App Settings` page — fields left empty fall back to `config.yaml`
- Inactivity rules, punishments, verification, pending reviews: dedicated dashboard pages

### Install And Run

Set `database.url` in `config.yaml` or export `DATABASE_URL` before running a real install.
`memory://local` is only supported when you opt into it explicitly for tests or ephemeral local runs.

Install the dependencies and start the application:

```shell
npm install
npm start
```

## Setup Via Discord

After installing and running the application, basic setup needs to be done to integrate the application.

Run the `/dashboard` slash command in Discord (or open the web UI directly) to do the basic setup:

- Create a bridge and assign Minecraft instances and Discord channels to it
- Configure per-bridge settings (channels, staff roles, chat commands, moderation, translations, interviews, stats topics, etc.) on the `Settings` page of the dashboard

## Credits

- duckysolucky
- The Project is inspired by [hypixel-discord-chat-bridge by Senither](https://github.com/Senither/hypixel-discord-chat-bridge).
- [Soopyboo32](https://github.com/Soopyboo32) for providing [an awesome command API](https://soopy.dev/commands)
- Aura#5051 for in-game commands: Calculate, 8ball, IQ, Networth, Weight, Bitches
- [WildWolfsblut](https://github.com/WildWolfsblut) for helping with various designs and structures
- All contributors whether by code, ideas/suggestions or testing
