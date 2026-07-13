const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PANEL_URL = process.env.PANEL_URL;
const BOT_SECRET = process.env.BOT_SECRET;

if (!BOT_TOKEN || !PANEL_URL || !BOT_SECRET) {
    console.error('❌ متغیرهای BOT_TOKEN, PANEL_URL, BOT_SECRET تنظیم نشده‌اند!');
    process.exit(1);
}

// اطمینان از وجود پروتکل در آدرس پنل
let API_BASE = PANEL_URL;
if (!API_BASE.startsWith('http://') && !API_BASE.startsWith('https://')) {
    API_BASE = 'https://' + API_BASE;
}
// حذف اسلش انتهایی
if (API_BASE.endsWith('/')) API_BASE = API_BASE.slice(0, -1);

const SESSIONS_FILE = path.join(__dirname, '../botdata/sessions.json');
const SESSIONS_DIR = path.dirname(SESSIONS_FILE);

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// =============== مدیریت نشست‌ها ===============
let sessions = {};
if (fs.existsSync(SESSIONS_FILE)) {
    try {
        sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch (e) { sessions = {}; }
}

function saveSessions() {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// =============== وضعیت‌های کاربران ===============
const userStates = {}; // 'idle' | 'awaiting_username' | 'awaiting_password' | 'awaiting_config_name' | 'awaiting_config_days'
const userTemp = {}; // داده‌های موقت برای حذف و ساخت

// =============== توابع کمکی ===============
function getSession(chatId) {
    return sessions[chatId] || null;
}

function setSession(chatId, username) {
    sessions[chatId] = { username, loggedIn: true };
    saveSessions();
}

function clearSession(chatId) {
    delete sessions[chatId];
    saveSessions();
    delete userStates[chatId];
    delete userTemp[chatId];
}

function isLoggedIn(chatId) {
    return sessions[chatId] && sessions[chatId].loggedIn;
}

async function callApi(endpoint, method = 'GET', body = null, chatId = null) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'X-Bot-Secret': BOT_SECRET,
    };
    if (chatId && isLoggedIn(chatId)) {
        headers['X-Username'] = sessions[chatId].username;
    }
    const options = {
        method,
        headers,
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    try {
        const res = await fetch(url, options);
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('API Error:', e.message);
        return { success: false, message: 'خطا در ارتباط با پنل' };
    }
}

function sendMessage(chatId, text, keyboard = null) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
    };
    if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
    }
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

function editMessage(chatId, messageId, text, keyboard = null) {
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML',
    };
    if (keyboard) {
        payload.reply_markup = JSON.stringify(keyboard);
    }
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

function answerCallback(callbackId, text, showAlert = false) {
    return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            callback_query_id: callbackId,
            text: text,
            show_alert: showAlert,
        }),
    });
}

// =============== صفحه‌کلیدهای شیشه‌ای ===============
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔑 ورود به حساب', callback_data: 'menu_login' }],
            [{ text: '📋 لیست کانفیگ‌ها', callback_data: 'menu_list' }],
            [{ text: '➕ ساخت کانفیگ جدید', callback_data: 'menu_new' }],
            [{ text: '❌ حذف کانفیگ', callback_data: 'menu_delete' }],
            [{ text: '🚪 خروج از حساب', callback_data: 'menu_logout' }],
            [{ text: 'ℹ️ راهنما', callback_data: 'menu_help' }],
        ],
    };
}

function backMenuButton() {
    return {
        inline_keyboard: [
            [{ text: '🔙 بازگشت به منو', callback_data: 'menu_main' }],
        ],
    };
}

// =============== نمایش منوی اصلی ===============
async function showMainMenu(chatId, messageId = null) {
    const text = `🤖 <b>ربات مدیریت پنل داوری</b>

لطفاً یکی از گزینه‌های زیر را انتخاب کنید:`;

    if (messageId) {
        await editMessage(chatId, messageId, text, mainMenuKeyboard());
    } else {
        await sendMessage(chatId, text, mainMenuKeyboard());
    }
}

// =============== مدیریت دستورات و پیام‌ها ===============
async function handleUpdate(update) {
    // ---------- پیام‌های متنی ----------
    if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        // دستور /start
        if (text === '/start') {
            userStates[chatId] = 'idle';
            return showMainMenu(chatId);
        }

        // مدیریت وضعیت‌های مکالمه‌ای
        const state = userStates[chatId] || 'idle';

        // --- دریافت یوزرنیم ---
        if (state === 'awaiting_username') {
            userStates[chatId] = 'awaiting_password';
            userTemp[chatId] = { username: text };
            await sendMessage(chatId, `🔑 حالا رمز عبور خود را وارد کنید:`, backMenuButton());
            return;
        }

        // --- دریافت رمز عبور ---
        if (state === 'awaiting_password') {
            const username = userTemp[chatId]?.username;
            if (!username) {
                userStates[chatId] = 'idle';
                return showMainMenu(chatId);
            }
            const password = text;

            // لاگین به پنل
            const result = await callApi('/bot/login', 'POST', { username, password });
            if (result.success) {
                setSession(chatId, username);
                userStates[chatId] = 'idle';
                delete userTemp[chatId];
                await sendMessage(chatId, `✅ <b>ورود موفق!</b>\nخوش آمدید ${username}`, mainMenuKeyboard());
            } else {
                userStates[chatId] = 'idle';
                delete userTemp[chatId];
                await sendMessage(chatId, `❌ خطا در ورود: ${result.message || 'نام کاربری یا رمز اشتباه است'}`, mainMenuKeyboard());
            }
            return;
        }

        // --- دریافت نام کانفیگ جدید ---
        if (state === 'awaiting_config_name') {
            userStates[chatId] = 'awaiting_config_days';
            userTemp[chatId] = { ...userTemp[chatId], name: text };
            await sendMessage(chatId, `📅 تعداد روزهای اعتبار کانفیگ را به عدد وارد کنید (مثلاً 30):`, backMenuButton());
            return;
        }

        // --- دریافت تعداد روزهای کانفیگ جدید ---
        if (state === 'awaiting_config_days') {
            const name = userTemp[chatId]?.name;
            if (!name) {
                userStates[chatId] = 'idle';
                return showMainMenu(chatId);
            }
            const days = parseInt(text);
            if (isNaN(days) || days <= 0) {
                await sendMessage(chatId, `❌ لطفاً یک عدد معتبر بزرگتر از صفر وارد کنید.`, backMenuButton());
                return;
            }

            const result = await callApi('/bot/new-config', 'POST', { name, days }, chatId);
            userStates[chatId] = 'idle';
            delete userTemp[chatId];

            if (result.success) {
                await sendMessage(chatId, `✅ <b>کانفیگ با موفقیت ساخته شد!</b>\n\n🔹 نام: ${name}\n📅 اعتبار: ${days} روز\n🆔 UUID: ${result.config?.uuid || '---'}`, mainMenuKeyboard());
            } else {
                await sendMessage(chatId, `❌ خطا در ساخت کانفیگ: ${result.message || 'مشخص نیست'}`, mainMenuKeyboard());
            }
            return;
        }

        // اگر کاربر در وضعیت خاصی نبود، هر پیام دیگری را نادیده بگیر
        if (!text.startsWith('/')) {
            await sendMessage(chatId, `❌ دستور نامعتبر. لطفاً از دکمه‌های منو استفاده کنید.`, mainMenuKeyboard());
        }
        return;
    }

    // ---------- کلیک روی دکمه‌ها (Callback Query) ----------
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const callbackId = query.id;

        // پاسخ به تلگرام برای جلوگیری از چرخیدن دکمه
        await answerCallback(callbackId);

        // ---- منوی اصلی ----
        if (data === 'menu_main') {
            userStates[chatId] = 'idle';
            return showMainMenu(chatId, messageId);
        }

        // ---- ورود ----
        if (data === 'menu_login') {
            if (isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'شما قبلاً وارد شده‌اید!', true);
                return showMainMenu(chatId, messageId);
            }
            userStates[chatId] = 'awaiting_username';
            await editMessage(chatId, messageId, `👤 لطفاً <b>یوزرنیم</b> خود را وارد کنید:`, backMenuButton());
            return;
        }

        // ---- لیست کانفیگ‌ها ----
        if (data === 'menu_list') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'لطفاً ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            const result = await callApi('/bot/configs', 'GET', null, chatId);
            if (result.success && result.configs && result.configs.length > 0) {
                let listText = `📋 <b>لیست کانفیگ‌های شما (${result.configs.length} مورد):</b>\n\n`;
                result.configs.forEach((cfg, index) => {
                    const expiry = new Date(cfg.expiry).toLocaleDateString('fa-IR');
                    const up = (cfg.up / 1024 / 1024).toFixed(1);
                    const down = (cfg.down / 1024 / 1024).toFixed(1);
                    listText += `${index + 1}. <b>${cfg.name}</b>\n   📅 انقضا: ${expiry}\n   📊 مصرف: ${up}MB / ${down}MB\n\n`;
                });
                await editMessage(chatId, messageId, listText, {
                    inline_keyboard: [
                        [{ text: '🔙 بازگشت به منو', callback_data: 'menu_main' }],
                    ],
                });
            } else {
                await editMessage(chatId, messageId, `📭 شما هیچ کانفیگی ندارید.`, backMenuButton());
            }
            return;
        }

        // ---- ساخت کانفیگ جدید ----
        if (data === 'menu_new') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'لطفاً ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            userStates[chatId] = 'awaiting_config_name';
            await editMessage(chatId, messageId, `✏️ لطفاً یک <b>نام</b> برای کانفیگ جدید وارد کنید (مثلاً: موبایل یا لپ‌تاپ):`, backMenuButton());
            return;
        }

        // ---- حذف کانفیگ ----
        if (data === 'menu_delete') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'لطفاً ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            const result = await callApi('/bot/configs', 'GET', null, chatId);
            if (!result.success || !result.configs || result.configs.length === 0) {
                await editMessage(chatId, messageId, `📭 شما هیچ کانفیگی برای حذف ندارید.`, backMenuButton());
                return;
            }

            // ساخت دکمه‌های حذف برای هر کانفیگ
            const buttons = result.configs.map((cfg) => {
                return [{ text: `🗑️ ${cfg.name}`, callback_data: `del_${cfg.name}` }];
            });
            buttons.push([{ text: '🔙 بازگشت به منو', callback_data: 'menu_main' }]);

            await editMessage(chatId, messageId, `⚠️ لطفاً کانفیگ مورد نظر برای <b>حذف</b> را انتخاب کنید:`, {
                inline_keyboard: buttons,
            });
            return;
        }

        // ---- اجرای حذف (دریافت نام از دکمه) ----
        if (data.startsWith('del_')) {
            const name = data.substring(4); // حذف "del_"
            // ذخیره نام در حافظه موقت برای تأیید
            userTemp[chatId] = { deleteTarget: name };
            await editMessage(chatId, messageId, `⚠️ آیا از حذف کانفیگ <b>${name}</b> اطمینان دارید؟`, {
                inline_keyboard: [
                    [{ text: '✅ بله، حذف شود', callback_data: 'confirm_del_yes' }],
                    [{ text: '❌ انصراف', callback_data: 'confirm_del_no' }],
                ],
            });
            return;
        }

        // ---- تأیید حذف ----
        if (data === 'confirm_del_yes') {
            const name = userTemp[chatId]?.deleteTarget;
            if (!name) {
                await editMessage(chatId, messageId, `❌ خطا: نام کانفیگ یافت نشد.`, backMenuButton());
                return;
            }
            const result = await callApi(`/bot/configs?name=${encodeURIComponent(name)}`, 'DELETE', null, chatId);
            delete userTemp[chatId];
            if (result.success) {
                await editMessage(chatId, messageId, `✅ کانفیگ <b>${name}</b> با موفقیت حذف شد.`, mainMenuKeyboard());
            } else {
                await editMessage(chatId, messageId, `❌ خطا در حذف: ${result.message || 'مشخص نیست'}`, mainMenuKeyboard());
            }
            return;
        }

        if (data === 'confirm_del_no') {
            delete userTemp[chatId];
            await editMessage(chatId, messageId, `عملیات حذف لغو شد.`, mainMenuKeyboard());
            return;
        }

        // ---- خروج از حساب ----
        if (data === 'menu_logout') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'شما وارد نشده‌اید!', true);
                return showMainMenu(chatId, messageId);
            }
            clearSession(chatId);
            await editMessage(chatId, messageId, `🚪 شما با موفقیت <b>خارج</b> شدید.`, mainMenuKeyboard());
            return;
        }

        // ---- راهنما ----
        if (data === 'menu_help') {
            const helpText = `ℹ️ <b>راهنمای ربات</b>

🔹 <b>ورود</b>: با نام کاربری و رمز پنل وارد شوید.
🔹 <b>لیست</b>: کانفیگ‌های فعال خود را مشاهده کنید.
🔹 <b>ساخت</b>: یک کانفیگ جدید با نام دلخواه و روز اعتبار بسازید.
🔹 <b>حذف</b>: کانفیگ مورد نظر را انتخاب و حذف کنید.
🔹 <b>خروج</b>: از حساب خود خارج می‌شوید.

📌 تمام عملیات از طریق دکمه‌ها انجام می‌شود.`;
            await editMessage(chatId, messageId, helpText, backMenuButton());
            return;
        }

        // اگر هیچکدام نبود
        await answerCallback(callbackId, 'گزینه نامعتبر!', true);
    }
}

// =============== دریافت آپدیت‌ها (لانگ‌پولینگ) ===============
let offset = 0;
async function pollUpdates() {
    while (true) {
        try {
            const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=30&offset=${offset}`);
            const data = await res.json();
            if (data.ok && data.result) {
                for (const update of data.result) {
                    await handleUpdate(update);
                    offset = update.update_id + 1;
                }
            }
        } catch (e) {
            console.error('Polling error:', e.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

console.log('✅ ربات تلگرام با منوی دکمه‌ای راه‌اندازی شد!');
pollUpdates();
