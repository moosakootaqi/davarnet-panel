const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PANEL_URL = process.env.PANEL_URL;
const BOT_SECRET = process.env.BOT_SECRET;

if (!BOT_TOKEN || !PANEL_URL || !BOT_SECRET) {
    console.error('❌ متغیرهای محیطی تنظیم نشده‌اند');
    process.exit(1);
}

// اگر پروتکل نداشت، اضافه کن
let API_BASE = PANEL_URL;
if (!API_BASE.startsWith('http://') && !API_BASE.startsWith('https://')) {
    API_BASE = 'https://' + API_BASE;
}
if (API_BASE.endsWith('/')) API_BASE = API_BASE.slice(0, -1);

const SESSIONS_FILE = path.join(__dirname, '../botdata/sessions.json');
const SESSIONS_DIR = path.dirname(SESSIONS_FILE);
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// ========== مدیریت نشست‌ها ==========
let sessions = {};
if (fs.existsSync(SESSIONS_FILE)) {
    try {
        sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    } catch (e) { sessions = {}; }
}

function saveSessions() {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

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
}

function isLoggedIn(chatId) {
    return sessions[chatId] && sessions[chatId].loggedIn;
}

// ========== وضعیت‌های کاربران ==========
const userStates = {}; // 'idle' | 'awaiting_username' | 'awaiting_password' | 'awaiting_config_name' | 'awaiting_config_days'
const userTemp = {};

// ========== ارسال درخواست به API پنل ==========
async function callApi(endpoint, method = 'GET', body = null, chatId = null) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'X-Bot-Secret': BOT_SECRET,
    };
    if (chatId && isLoggedIn(chatId)) {
        headers['X-Username'] = sessions[chatId].username;
    }
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
        const res = await fetch(url, options);
        return await res.json();
    } catch (e) {
        console.error('API Error:', e.message);
        return { success: false, message: 'خطا در ارتباط با پنل' };
    }
}

// ========== توابع تلگرام ==========
function sendMessage(chatId, text, keyboard = null) {
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
    };
    if (keyboard) payload.reply_markup = JSON.stringify(keyboard);
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
        text,
        parse_mode: 'HTML',
    };
    if (keyboard) payload.reply_markup = JSON.stringify(keyboard);
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
            text,
            show_alert: showAlert,
        }),
    });
}

// ========== صفحه‌کلیدها ==========
function mainMenu() {
    return {
        inline_keyboard: [
            [{ text: '🔑 ورود', callback_data: 'login' }],
            [{ text: '📋 لیست کانفیگ‌ها', callback_data: 'list' }],
            [{ text: '➕ ساخت کانفیگ جدید', callback_data: 'new' }],
            [{ text: '❌ حذف کانفیگ', callback_data: 'delete' }],
            [{ text: '🚪 خروج', callback_data: 'logout' }],
            [{ text: 'ℹ️ راهنما', callback_data: 'help' }],
        ],
    };
}

function backMenu() {
    return {
        inline_keyboard: [
            [{ text: '🔙 بازگشت به منو', callback_data: 'main' }],
        ],
    };
}

// ========== نمایش منوی اصلی ==========
async function showMainMenu(chatId, messageId = null) {
    const text = `🤖 <b>ربات مدیریت پنل داوری</b>\n\nلطفاً یکی از گزینه‌ها را انتخاب کنید:`;
    if (messageId) {
        await editMessage(chatId, messageId, text, mainMenu());
    } else {
        await sendMessage(chatId, text, mainMenu());
    }
}

// ========== مدیریت آپدیت‌ها ==========
async function handleUpdate(update) {
    // ------ پیام متنی (برای ادامهٔ مکالمه) ------
    if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        if (text === '/start') {
            userStates[chatId] = 'idle';
            delete userTemp[chatId];
            return showMainMenu(chatId);
        }

        const state = userStates[chatId] || 'idle';

        // ورود - مرحلهٔ یوزرنیم
        if (state === 'awaiting_username') {
            userStates[chatId] = 'awaiting_password';
            userTemp[chatId] = { username: text };
            await sendMessage(chatId, `🔑 حالا رمز عبور را وارد کنید:`, backMenu());
            return;
        }

        // ورود - مرحلهٔ رمز عبور
        if (state === 'awaiting_password') {
            const username = userTemp[chatId]?.username;
            if (!username) {
                userStates[chatId] = 'idle';
                return showMainMenu(chatId);
            }
            const password = text;

            const result = await callApi('/bot/login', 'POST', { username, password });
            if (result.success) {
                setSession(chatId, username);
                userStates[chatId] = 'idle';
                delete userTemp[chatId];
                await sendMessage(chatId, `✅ <b>ورود موفق!</b>\nخوش آمدید ${username}`, mainMenu());
            } else {
                userStates[chatId] = 'idle';
                delete userTemp[chatId];
                await sendMessage(chatId, `❌ خطا در ورود: ${result.message || 'نام کاربری یا رمز اشتباه است'}`, mainMenu());
            }
            return;
        }

        // ساخت کانفیگ - مرحلهٔ نام
        if (state === 'awaiting_config_name') {
            userStates[chatId] = 'awaiting_config_days';
            userTemp[chatId] = { name: text };
            await sendMessage(chatId, `📅 تعداد روزهای اعتبار را به عدد وارد کنید:`, backMenu());
            return;
        }

        // ساخت کانفیگ - مرحلهٔ روز
        if (state === 'awaiting_config_days') {
            const name = userTemp[chatId]?.name;
            if (!name) {
                userStates[chatId] = 'idle';
                return showMainMenu(chatId);
            }
            const days = parseInt(text);
            if (isNaN(days) || days <= 0) {
                await sendMessage(chatId, `❌ لطفاً یک عدد معتبر بزرگتر از صفر وارد کنید.`, backMenu());
                return;
            }

            const result = await callApi('/bot/new-config', 'POST', { name, days }, chatId);
            userStates[chatId] = 'idle';
            delete userTemp[chatId];

            if (result.success) {
                await sendMessage(chatId, `✅ کانفیگ "${name}" با ${days} روز اعتبار ساخته شد.`, mainMenu());
            } else {
                await sendMessage(chatId, `❌ خطا: ${result.message || 'مشخص نیست'}`, mainMenu());
            }
            return;
        }

        // اگر کاربر در حال مکالمه نبود، پیام نادیده گرفته شود
        if (!text.startsWith('/')) {
            await sendMessage(chatId, `❌ لطفاً از دکمه‌های منو استفاده کنید.`, mainMenu());
        }
        return;
    }

    // ------ کلیک روی دکمه (CallbackQuery) ------
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;
        const callbackId = query.id;

        await answerCallback(callbackId);

        // بازگشت به منو
        if (data === 'main') {
            userStates[chatId] = 'idle';
            delete userTemp[chatId];
            return showMainMenu(chatId, messageId);
        }

        // ورود
        if (data === 'login') {
            if (isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'شما قبلاً وارد شده‌اید!', true);
                return showMainMenu(chatId, messageId);
            }
            userStates[chatId] = 'awaiting_username';
            await editMessage(chatId, messageId, `👤 لطفاً <b>یوزرنیم</b> خود را وارد کنید:`, backMenu());
            return;
        }

        // لیست کانفیگ‌ها
        if (data === 'list') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'لطفاً ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            const result = await callApi('/bot/configs', 'GET', null, chatId);
            if (result.success && result.configs && result.configs.length > 0) {
                let txt = `📋 <b>لیست کانفیگ‌ها (${result.configs.length}):</b>\n\n`;
                result.configs.forEach((cfg, i) => {
                    const exp = new Date(cfg.expiry).toLocaleDateString('fa-IR');
                    const up = (cfg.up / 1024 / 1024).toFixed(1);
                    const down = (cfg.down / 1024 / 1024).toFixed(1);
                    txt += `${i+1}. <b>${cfg.name}</b>\n   انقضا: ${exp}\n   مصرف: ${up}MB / ${down}MB\n\n`;
                });
                await editMessage(chatId, messageId, txt, {
                    inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'main' }]],
                });
            } else {
                await editMessage(chatId, messageId, `📭 هیچ کانفیگی ندارید.`, backMenu());
            }
            return;
        }

        // ساخت کانفیگ جدید
        if (data === 'new') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            userStates[chatId] = 'awaiting_config_name';
            await editMessage(chatId, messageId, `✏️ یک <b>نام</b> برای کانفیگ جدید وارد کنید:`, backMenu());
            return;
        }

        // حذف کانفیگ (نمایش لیست با دکمه)
        if (data === 'delete') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'ابتدا وارد شوید!', true);
                return showMainMenu(chatId, messageId);
            }
            const result = await callApi('/bot/configs', 'GET', null, chatId);
            if (!result.success || !result.configs || result.configs.length === 0) {
                await editMessage(chatId, messageId, `📭 کانفیگی برای حذف وجود ندارد.`, backMenu());
                return;
            }
            const buttons = result.configs.map((cfg) => [
                { text: `🗑️ ${cfg.name}`, callback_data: `del_${cfg.name}` },
            ]);
            buttons.push([{ text: '🔙 بازگشت', callback_data: 'main' }]);
            await editMessage(chatId, messageId, `⚠️ کانفیگ مورد نظر برای حذف را انتخاب کنید:`, {
                inline_keyboard: buttons,
            });
            return;
        }

        // اجرای حذف (وقتی کاربر روی دکمهٔ حذف یک کانفیگ کلیک کند)
        if (data.startsWith('del_')) {
            const name = data.substring(4);
            const result = await callApi(`/bot/configs?name=${encodeURIComponent(name)}`, 'DELETE', null, chatId);
            if (result.success) {
                await editMessage(chatId, messageId, `✅ کانفیگ "${name}" حذف شد.`, mainMenu());
            } else {
                await editMessage(chatId, messageId, `❌ خطا در حذف: ${result.message || 'مشخص نیست'}`, mainMenu());
            }
            return;
        }

        // خروج
        if (data === 'logout') {
            if (!isLoggedIn(chatId)) {
                await answerCallback(callbackId, 'شما وارد نشده‌اید!', true);
                return showMainMenu(chatId, messageId);
            }
            clearSession(chatId);
            userStates[chatId] = 'idle';
            delete userTemp[chatId];
            await editMessage(chatId, messageId, `🚪 شما خارج شدید.`, mainMenu());
            return;
        }

        // راهنما
        if (data === 'help') {
            const helpText = `ℹ️ <b>راهنما</b>\n\n🔹 ورود: نام کاربری و رمز پنل\n🔹 لیست: مشاهده کانفیگ‌ها\n🔹 ساخت: نام و روز اعتبار\n🔹 حذف: انتخاب از لیست\n🔹 خروج: پایان نشست\n\nتمامی عملیات با دکمه‌ها انجام می‌شود.`;
            await editMessage(chatId, messageId, helpText, backMenu());
            return;
        }

        // دکمه ناشناخته
        await answerCallback(callbackId, 'گزینه نامعتبر!', true);
    }
}

// ========== لانگ‌پولینگ ==========
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
        await new Promise(r => setTimeout(r, 1000));
    }
}

console.log('✅ ربات با منوی دکمه‌ای راه‌اندازی شد (منطق قبلی حفظ شد)');
pollUpdates();
