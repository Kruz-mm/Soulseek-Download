# Soulseek-Download

A Telegram bot that searches songs on the [Soulseek](https://www.slsknet.org/) peer-to-peer network and sends them straight to your chat.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Kruz-mm/Soulseek-Download/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-339933.svg)](https://nodejs.org/)
[![grammY](https://img.shields.io/badge/Telegram-grammY-009688.svg)](https://grammy.dev/)

---

## Overview

Soulseek-Download is a self-hosted Telegram bot written in Node.js. It connects to the Soulseek network with your account, lets you search for tracks directly from the chat, and delivers the selected file as a Telegram audio message — complete with embedded metadata and cover art when available.

The whole flow is driven by inline buttons: choose a format, pick one of the best-matching results, watch the live download progress, and receive the track.

## Features

- **Search from Telegram** — `/search <query>` finds tracks on Soulseek.
- **Format selection** — search specifically for `FLAC`, `MP3`, or any supported audio format (`mp3`, `flac`, `wav`, `m4a`).
- **Smart result ranking** — up to 5 results, filtered by format and size, sorted by peer upload speed.
- **Live progress bar** — download progress is rendered right inside the message.
- **Cancel anytime** — a single button stops an in-progress download.
- **Stall protection** — downloads with no progress for 25 seconds are cancelled automatically, so dead peers never hang the bot.
- **Rich metadata** — artist and title are read from audio tags; embedded cover art is sent as the audio thumbnail.
- **Filename fallback** — if a file has no tags, `Artist - Title` is parsed from the filename.
- **Automatic cleanup** — temporary files are always removed, even after errors or cancellations.
- **Crash-safe handlers** — a global error handler keeps the bot alive when something goes wrong.

## Requirements

- **Node.js 18+** (the project uses ES modules and top-level `await`)
- A **Telegram bot token** — create one via [@BotFather](https://t.me/BotFather)
- A **Soulseek account** (username and password)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/Kruz-mm/Soulseek-Download.git
   cd Soulseek-Download
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:

   ```env
   BOT_TOKEN=123456789:your-telegram-bot-token
   SOULSEEK_USER=your-soulseek-username
   SOULSEEK_PASS=your-soulseek-password
   ```

4. Start the bot:

   ```bash
   npm start
   ```

   On startup the bot logs into Soulseek and prints `Бот запущен` once it is ready to receive commands.

## Usage

| Step | Action |
| ---- | ------ |
| 1 | Send `/search Aphex Twin Alberto Balsalm` to the bot |
| 2 | Pick a format: `FLAC`, `MP3`, or `Любой формат` (any) |
| 3 | Choose one of the found tracks (filename and size are shown on the button) |
| 4 | Watch the progress bar, or press `Отменить` to abort |
| 5 | Receive the track as an audio message with tags and cover art |

> Note: the bot interface is currently in Russian.

## Configuration

All tunables live at the top of `index.js`:

| Constant | Value | Description |
| -------- | ----- | ----------- |
| `MAX_FILE_SIZE` | `50 MB` | Maximum file size. Matches the Telegram Bot API upload limit |
| `SEARCH_TIMEOUT` | `12000 ms` | How long to wait for peers to answer a search |
| `MAX_RESULTS` | `5` | Number of results offered to the user |
| `STALL_TIMEOUT` | `25000 ms` | No-progress timeout after which a download is cancelled |
| Progress throttle | `3000 ms` | Minimum interval between progress bar updates (avoids Telegram flood limits) |

## How It Works

```
User                 Bot                         Soulseek network
 |                    |                                |
 |-- /search query -->|                                |
 |<-- choose format --|                                |
 |-- FLAC/MP3/any --->|-- client.search -------------->|
 |                    |<-- raw results ----------------|
 |                    |    filter by format & size     |
 |                    |    sort by peer speed, top 5   |
 |<-- result buttons -|                                |
 |-- pick a track --->|-- client.download ------------>|
 |<-- progress bar ---|    (progress events)           |
 |                    |    music-metadata: tags+cover  |
 |<-- audio message --|                                |
```

In detail:

1. **Login** — on startup the bot authenticates against Soulseek using the credentials from `.env`.
2. **Search** — the query is stored in memory together with a unique `searchId`, and the user is asked to pick a format.
3. **Filtering** — raw results are filtered by the selected extension and the 50 MB limit, sorted by peer upload speed, and truncated to 5 entries.
4. **Download** — the selected file is written to the OS temporary directory. Progress events update the message at most once every 3 seconds; a watchdog timer cancels stalled downloads.
5. **Tagging** — `music-metadata` parses artist, title, and embedded cover art. If parsing fails, `Artist - Title` is extracted from the filename, and the uploading peer's username is used as a fallback artist.
6. **Delivery** — the file is sent via `replyWithAudio` and all temporary files are deleted in a `finally` block.

## Project Structure

```
Soulseek-Download/
├── index.js          # entire bot logic: commands, search, download, metadata
├── package.json      # dependencies and npm start script
├── package-lock.json
├── .env              # your credentials (not committed)
└── LICENSE           # MIT
```

## Limitations

- **50 MB cap** — due to Telegram Bot API restrictions, larger files (common for high-quality FLAC) are filtered out during search.
- **Peer availability** — download speed and success depend entirely on Soulseek users being online; stalled transfers are cancelled automatically.
- **Temporary storage** — files are stored in the system temp folder only until they are sent to Telegram.
- **Network** — some ISPs or VPNs may block Soulseek P2P traffic; a working connection to the Soulseek network is required.

## License

[MIT](https://github.com/Kruz-mm/Soulseek-Download/blob/main/LICENSE) © Kruz
