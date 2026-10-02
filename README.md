# Edville Moggmeter 🗿

A Telegram bot that measures a student's **Edvillianity** out of 1000. It
works in **any chat** the way `@pic` does: type `@EdvilleMoggBot` in any DM
or group, tap the card that pops up above the message box, and it's sent.
The bot doesn't have to be a member of that chat.

## How it works

* **Setup** (in the bot's private chat): real first and last name, GPA,
  class (1–11) and the date you joined Edville. The date can't be earlier than 01.09.2023, when Edville
  opened, and can't be in the future.
* **Your card only.** The inline query always returns the caller's own card.
  You can't pull up anyone else's.
* **Score** (out of 1000), in `src/score.js`:
  | part   | max | how                                                    |
  |--------|-----|--------------------------------------------------------|
  | GPA    | 500 | GPA / `GPA_MAX`                                        |
  | Tenure | 300 | share of Edville's lifetime you've been there for      |
  | Class  | 200 | class / 11                                             |
* Every sent card has three buttons: **⬆️ Appreciate · ⬇️ Depreciate · 🙅 Disagree**.
* **Appreciate / Depreciate** work like Reddit votes. One vote per
  person, pressing the same button again takes the vote back, and the card
  only shows the sum (`Rep: +7`).
* **Disagree** opens the bot's private chat. The user picks one field or
  "Everything" and sends what they think the real value is. When enough
  different users disagree on one field (`disputeThreshold` in
  `src/config.js`, 5 by default), the field takes the **median** of their
  claims (or, for the name, the most common claim) and is marked 👥 on the card. Users are never told how many
  disagreements it takes. A few rules:
  * One standing claim per user per field. Sending another replaces it.
  * Claims equal to the current value don't count.
  * You need a card of your own before you can disagree with someone else's.
  * After a correction, the owner can't edit that field. GPA and class unlock
    again on the next 1 September, since they change every school year. Name
    and join date stay locked.

## Setup

1. In [@BotFather](https://t.me/BotFather):
   * `/newbot` (or use an existing one) and copy the token.
   * **`/setinline`**, pick the bot, and set a placeholder such as
     `show your Moggmeter card`. **Without this the bot can't be used from
     other chats.**
2. Run:
   ```bash
   npm install
   cp .env.example .env     # put BOT_TOKEN in
   npm start
   ```
   On start the bot sets its display name to **Edville Moggmeter** and
   registers its commands.

State lives in one SQLite file (`DB_PATH`). Node 22+ is required (built-in
`node:sqlite`), and `grammy` is the only dependency.

## Commands (private chat)

`/start`, `/me`, `/edit`, `/help`, `/cancel`

## Limits

* A card that's already been posted in a chat updates when someone votes on
  it. A community correction shows up on new cards and on the next vote.
* Disputes count distinct Telegram accounts, so someone with five accounts
  can force a change. Requiring disputers to have their own card raises the
  bar but doesn't remove the problem.
