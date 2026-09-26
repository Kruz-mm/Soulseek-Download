import { Bot, InlineKeyboard, InputFile } from "grammy";
import { run } from "@grammyjs/runner";
import { parseFile } from "music-metadata";
import "dotenv/config";
import { SlskClient } from "slsk-client";
import fs from "fs";
import path from "path";
import os from "os";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // ограничение на скачивание — 50 МБ
const SEARCH_TIMEOUT = 12000;
const MAX_RESULTS = 5;
const STALL_TIMEOUT = 25000;

const EXTENSIONS = {
    flac: /\.flac$/i,
    mp3: /\.mp3$/i,
    any: /\.(mp3|flac|wav|m4a)$/i
};

const bot = new Bot(process.env.BOT_TOKEN);
const client = new SlskClient();

const pendingSearches = new Map(); // searchId -> текст запроса, ждущий выбора формата
const searchResults = new Map();   // searchId -> найденные файлы, готовые к скачиванию
const activeDownloads = new Map(); // message_id -> объект Download, чтобы можно было отменить

const downloadDir = path.join(os.tmpdir(), "soulseek-bot");
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

// вход в Soulseek при старте бота
try {
    await client.login(process.env.SOULSEEK_USER, process.env.SOULSEEK_PASS);
    console.log("Soulseek: вход выполнен");
} catch (err) {
    console.error("Soulseek: ошибка входа", err);
}

// без этого любая ошибка в хендлере роняет весь процесс
bot.catch((err) => {
    console.error("Ошибка в обработчике:", err.error);
});

bot.command("start", (ctx) =>
    ctx.reply(
        "Привет! Напиши:\n`/search <название трека>`\n\nЯ поищу его в Soulseek и предложу скачать.",
        { parse_mode: "Markdown" }
    )
);

function sizeLabel(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function guessArtistTitle(filename) {
    const clean = fileName.replace(/\.[^/.]+$/, "");
    const match = clean.match(/^(.+?)\s*-\s*(.+)$/);
    return match
        ? { artist: match[1].trim(), title: match[2].trim() }
        : { artist: null, title: clean };
}

// текстовый прогресс-бар для сообщений о скачивании
function progressBar(percent) {
    const filled = Math.round(percent / 10);
    return "▓".repeat(filled) + "░".repeat(10 - filled);
}

function formatKeyboard(searchId) {
    return new InlineKeyboard()
        .text("FLAC", `fmt_${searchId}_flac`)
        .text("MP3", `fmt_${searchId}_mp3`)
        .row()
        .text("Любой формат", `fmt_${searchId}_any`);
}

// список найденных треков в виде кнопок
function resultsKeyboard(searchId, results) {
    const keyboard = new InlineKeyboard();
    results.forEach((item, index) => {
        const name = item.file.split(/[\\/]/).pop();
        const shortName = name.length > 35 ? `${name.slice(0, 35)}…` : name;
        keyboard.text(`${shortName} — ${sizeLabel(item.size)}`, `dl_${searchId}_${index}`).row();
    });
    return keyboard;
}

// кнопка отмены под сообщением о прогрессе скачивания
function cancelKeyboard(downloadId) {
    return new InlineKeyboard().text("Отменить", `cancel_${downloadId}`);
}

bot.command("search", async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) {
        return ctx.reply(
            "Укажи название трека после команды, например:\n`/search Aphex Twin Alberto Balsalm`",
            { parse_mode: "Markdown" }
        );
    }

    const searchId = Date.now().toString();
    pendingSearches.set(searchId, query);

    await ctx.reply(`Запрос: *${query}*\n\nВ каком формате искать?`, {
        parse_mode: "Markdown",
        reply_markup: formatKeyboard(searchId)
    });
});

// пользователь выбрал формат — выполняем реальный поиск на сервере
bot.callbackQuery(/^fmt_(\d+)_(flac|mp3|any)$/, async (ctx) => {
    const [, searchId, format] = ctx.match;
    const query = pendingSearches.get(searchId);

    if (!query) {
        return ctx.answerCallbackQuery({ text: "Запрос устарел, начните поиск заново", show_alert: true }).catch(() => {});
    }

    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText(`Ищу: *${query}*...`, { parse_mode: "Markdown" });

    try {
        const raw = await client.search({ req: query, timeout: SEARCH_TIMEOUT });

        const filtered = raw
            .filter((item) => EXTENSIONS[format].test(item.file))
            .filter((item) => item.size <= MAX_FILE_SIZE)
            .sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0))
            .slice(0, MAX_RESULTS);

        if (filtered.length === 0) {
            await ctx.editMessageText("Ничего не найдено. Попробуйте другой формат или запрос.");
            return;
        }

        searchResults.set(searchId, filtered);

        await ctx.editMessageText(`Найдено треков: ${filtered.length}\nВыберите один:`, {
            reply_markup: resultsKeyboard(searchId, filtered)
        });
    } catch (err) {
        console.error("Ошибка поиска:", err);
        await ctx.editMessageText("Не удалось выполнить поиск. Попробуйте позже.");
    } finally {
        pendingSearches.delete(searchId);
    }
});

// пользователь нажал "Отменить" на зависшем скачивании
bot.callbackQuery(/^cancel_(\d+)$/, async (ctx) => {
    const downloadId = ctx.match[1];
    const download = activeDownloads.get(downloadId);

    if (!download) {
        return ctx.answerCallbackQuery({ text: "Скачивание уже завершено" }).catch(() => {});
    }

    download.cancel();
    await ctx.answerCallbackQuery({ text: "Останавливаю скачивание..." }).catch(() => {});
});

bot.callbackQuery(/^dl_(\d+)_(\d+)$/, async (ctx) => {
    const [, searchId, indexStr] = ctx.match;
    const results = searchResults.get(searchId);
    const file = results?.[Number(indexStr)];

    if (!file) {
        return ctx.answerCallbackQuery({ text: "Запрос устарел, выполните поиск заново", show_alert: true }).catch(() => {});
    }

    const rawName = file.file.split(/[\\/]/).pop();
    const safeName = rawName.replace(/[/\\?%*:|"<>]/g, "_");
    const tempPath = path.join(downloadDir, `${Date.now()}_${safeName}`);

    const downloadId = Date.now().toString();

    await ctx.answerCallbackQuery({ text: "Начинаю скачивание" }).catch(() => {});
    const statusMsg = await ctx.reply(`Скачиваю: *${safeName}*\n\`${progressBar(0)}\` 0%`, {
        parse_mode: "Markdown",
        reply_markup: cancelKeyboard(downloadId)
    });

    let lastPercent = -1;
    let lastEditTime = 0;
    let stallTimer;
    let thumbPath;

    try {
        const download = client.download({ ...file, path: tempPath });
        activeDownloads.set(downloadId, download);

        stallTimer = setTimeout(() => download.cancel(), STALL_TIMEOUT);
        const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => download.cancel(), STALL_TIMEOUT);
        };

        // обновляем сообщение с прогрессом, но не чаще раза в 3 секунды
        download.on("progress", ({ progress }) => {
            resetStallTimer();

            const percent = Math.round((progress ?? 0) * 100);
            const now = Date.now();
            if (percent === lastPercent || now - lastEditTime < 3000) return;

            lastPercent = percent;
            lastEditTime = now;
            ctx.api
                .editMessageText(
                    ctx.chat.id,
                    statusMsg.message_id,
                    `Скачиваю: *${safeName}*\n\`${progressBar(percent)}\` ${percent}%`,
                    { parse_mode: "Markdown", reply_markup: cancelKeyboard(downloadId) }
                )
                .catch(() => {});
        });

        await download;

        let performer = file.user;
        let title = safeName.replace(/\.[^/.]+$/, "");
        let thumbnail;

        try {
            const metadata = await parseFile(tempPath);
            if (metadata.common.artist) performer = metadata.common.artist;
            if (metadata.common.title) title = metadata.common.title;

            const picture = metadata.common.picture?.[0];
            if (picture) {
                thumbnail = `${tempPath}.jpg`;
                fs.writeFileSync(thumbPath, picture.data);
                thumbnail = new InputFile(thumbPath);
            }
        } catch {
            const guess = guessArtistTitle(rawName);
            if (guess.artist) performer = guess.artist;
            title = guess.title;
        }

        await ctx.replyWithAudio(new InputFile(tempPath), { title, performer, thumbnail });
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

    } catch (err) {
        const cancelled = err.name === "DownloadCancelledError";
        if (!cancelled) console.error("Ошибка скачивания:", err);

        await ctx.api
            .editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                cancelled
                    ? "Скачивание отменено"
                    : "Не удалось скачать файл (пир недоступен или обрыв соединения). Выберите другой трек."
            )
            .catch(() => {});
    } finally {
        clearTimeout(stallTimer);
        activeDownloads.delete(downloadId);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        if (thumbPath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        searchResults.delete(searchId);
    }
});

console.log("Бот запущен");
run(bot);