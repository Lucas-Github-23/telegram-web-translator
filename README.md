# telegram-web-translator

> Fast, native-feeling translator for Telegram Web. Features hover translation, live typing preview with back-translation, and Gemini AI support.

---

## ✨ Features

- **Hover Translation**: Hold a modifier key (e.g. `Ctrl`, `Alt`, or `Shift`) or toggle lock mode to translate messages on hover. Reverts to original instantly on mouse leave.
- **Full Chat Translation**: Translate all visible messages in the current view with a single shortcut (`Alt + T`).
- **Live Typing with Retro-Translation**: Live translation preview as you type with automatic back-translation into Portuguese to verify exact nuance before sending.
- **One-Key Insertion**: Press **`Tab`** to replace your drafted text with the translated output instantly.
- **Dual Translation Engines**:
  - **Google Translate**: Fast, zero setup required.
  - **Gemini 1.5 Flash**: Context-aware AI translation with support for informal Russian chat slang (*хз*, *кст*, *норм*).
- **Zero Token Waste**: In-memory caching ensures you never waste tokens re-translating messages you've already hovered over.
- **Native Telegram Styling**: Integrated UI that adheres strictly to Telegram Desktop's dark palette without glowing neon effects or UI clutter.
- **Emoji & Layout Safe**: Preserves Telegram's custom and native emojis without stripping or breaking timestamps and badges.

---

## 🚀 Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/telegram-web-translator.git
   ```
2. Open your Chromium-based browser (Chrome, Brave, Edge, Opera) and navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the project directory (`Translate Extension`).
5. Open [Telegram Web](https://web.telegram.org/) and start chatting!

---

## ⌨️ Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **`Ctrl` + Hover** | Translate message on mouseover (customizable to `Alt` or `Shift`) |
| **`Tab`** | Insert translated text into message field |
| **`Alt + T`** | Toggle translation for all messages currently on screen |
| **`Ctrl + Z`** | Undo inserted translation in input field |
| **`Esc`** | Dismiss live translation preview dock |

---

## ⚙️ Configuration

Click the extension icon in your browser toolbar to:
- Switch between **Google** and **Gemini AI** engines.
- Add your free **Gemini API Key** (generate one at [Google AI Studio](https://aistudio.google.com/app/apikey)).
- Select incoming and outgoing target languages.
- Choose between **Hold** (hover while pressing key) and **Toggle** (lock translator on/off).

---

## 🛡️ Privacy & Performance

- **Direct Communication**: Translation requests are handled strictly via the browser's background service worker directly to official Google / Gemini endpoints.
- **Zero Tracking**: No external analytics, tracking scripts, or third-party servers.
- **Manifest V3**: Built in compliance with Chrome's latest extension standard.

---

## 📄 License

MIT License. Feel free to use, modify, and distribute.
