# Edville Moggmeter 🗿

A Telegram bot that measures a student's **Edvillianity** out of 3000. It
works in **any chat** the way `@pic` does: type `@EdvilleMoggBot` in any DM
or group and tap one of the buttons that pop up above the message box:

* **🗿 Press to send your card**: your card, with **⬆️ Appreciate ·
  ⬇️ Depreciate · 🙅 Disagree** under it.
* **⚔️ Press to start a Moggduel**: anyone with a card can accept.
  `@EdvilleMoggBot @username` challenges one person only.

The bot doesn't have to be a member of that chat.

## How it works

* **Setup** (in the bot's private chat): real first and last name, class
  (1–11), GPA, IELTS band and SAT score (or "didn't take it"), and the date
  you joined Edville. That date can't be earlier than 01.09.2023, when
  Edville opened, and can't be in the future.
* **Your card only.** Inline mode always shows the caller's own card.
* **No editing.** Once a card is made, its owner can't change it, with one
  exception: when other students disagree with a field (see below).
* **Score**, out of 3000, in `src/score.js`:
  | part   |  max | how                                               |
  |--------|-----:|---------------------------------------------------|
  | GPA    | 1000 | GPA / `GPA_MAX`                                   |
  | Tenure |  600 | share of Edville's lifetime you've been there for |
  | IELTS  |  500 | band / 9, nothing if not taken                    |
  | SAT    |  500 | 400 → nothing, 1600 → full, nothing if not taken  |
  | Class  |  400 | class / 11                                        |
* **Appreciate / Depreciate** work like Reddit votes. One vote per person,
  pressing the same button again takes the vote back, and the card shows
  only the sum (`Rep: +7`).
* **Disagree** opens the bot's private chat. The user picks one field or
  "Everything" and sends what they think the real value is. Once enough
  disagreements pile up on a field (`src/config.js`), that field is
  **flagged**:
  * the owner is told what people disagree with and what they think it is,
  * the card is **hidden** until the owner fixes the field: inline mode
    offers only "Your card needs fixing", and votes on old card messages
    turn them into "this card is being corrected",
  * the owner must enter a different value (`/fix`), and then the card is
    back.

  Users are never told how many disagreements it takes. One standing claim
  per user per field, and claims equal to the current value don't count.
  You need a card of your own before you can disagree with someone else's.
* **Developers** (`DEV_IDS`) get a 🛠 badge on their card, and their
  disagreement weighs more (`src/config.js`).
* **Moggduels** are decided by hidden factors (`src/duel.js`). Users only see
  the winner and a vague margin. Keep that file private: nothing in it is
  meant to be explained to users.
  * **You can only duel in a chat where you've shown your card**, and that
    goes for both the challenger and whoever accepts. An inline message
    doesn't tell the bot which chat it's in, so the bot learns where a card
    was shown in two ways: from the "via @bot" message in a group the bot is a
    member of (always, as soon as it's posted), or from anyone pressing one of
    the card's buttons (in any chat, the owner included). A card nobody has
    touched yet in a chat without the bot doesn't count there.
  * If the bot is a **member of a group with privacy mode off**, it counts
    how many messages each person writes there (counts only, no content), and
    duels posted in that group use them. In BotFather: `/setprivacy` →
    the bot → **Disable**, then remove the bot from the group and add it again.
  * Everywhere else (DMs, groups without the bot) the bot can't see messages,
    so that part is random.

## Setup

1. In [@BotFather](https://t.me/BotFather): `/newbot` (or use an existing
   one), copy the token, and turn inline mode on: `/mybots` → the bot →
   **Bot Settings** → **Inline Mode** → **Turn on**.
2. Run:
   ```bash
   npm install
   cp .env.example .env     # put BOT_TOKEN in
   npm start
   ```
   On start the bot sets its display name to **Edville Moggmeter** and
   registers its commands.

Only **one** copy of the bot can run per token. A second one gets
`409: Conflict: terminated by other getUpdates request`.

State lives in one SQLite file (`DB_PATH`). Node 22+ is required (built-in
`node:sqlite`), and `grammy` is the only dependency.

## Commands (private chat)

`/start`, `/me`, `/fix`, `/help`, `/cancel`
