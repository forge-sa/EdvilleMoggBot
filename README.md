# Edville Moggmeter 🗿

A Telegram bot that measures a student's **Edvillianity** out of 3000. It
works in **any chat** the way `@pic` does: type `@EdvilleMoggBot` in any DM
or group and tap one of the buttons that pop up above the message box:

* **🗿 Press to send your card**: your card, with **⬆️ Appreciate ·
  ⬇️ Depreciate · 🙅 Disagree** under it.
* **⚔️ Press to start a Moggduel**: anyone with a card can accept.
  `@EdvilleMoggBot @username` challenges one person only.
* **Your Edvies**, as cards: send one to show it off, with a **⚔️ Battle**
  button under it. `@EdvilleMoggBot <name>` finds one by name.

Inline results that are only pictures appear as a bare picture grid, so the
bot always puts a text result among them (your card, or "🎲 Random fighter").
Telegram then shows a list with each Edvie's name and specs next to its card.

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

## Edvies

Edvies are collectible creatures, and **all of them are made by the
community**. The code contains none; they live in the database.

* **Making one** (`/newedvie` in the bot's chat): rarity → name → cost →
  sprite → specs → preview of the rendered card → *Send for review*.
  * **Rarity**, rarest last, each with its own colour and price range:
    | rarity     | colour | price (🪙) |
    |------------|--------|-----------:|
    | Common     | grey   |   50–100   |
    | Rare       | green  |  100–200   |
    | Super Rare | blue   |  200–350   |
    | Epic       | purple |  350–600   |
    | Mythic     | red    |  600–1000  |
    | Legendary  | yellow | 1000–2000  |
  * **Name**: 2–20 Latin letters/digits (the card's font is Latin-only), unique.
  * **Sprite**: a photo, or better a PNG with a transparent background sent
    as a file.
  * **Specs**: exactly 100 points split between ❤️ Health, ⚔️ Damage and
    ⚡ Speed, at least 30 each, so every spec ends up between 30 and 40 and
    nobody can build a 1-HP sprinter. The list of specs is `STATS` in
    `src/edvie.js`; a new spec added there is asked for, stored and shown
    everywhere (what it *does* in battle still needs code).
  * At most 3 waiting for review per person.
* **Review**: every submission goes to the developers (`DEV_IDS`) as a
  rendered card with **Approve**, **Reject** (with an optional reason), and
  **edit Name / Rarity / Cost / Specs** buttons. `/review` lists everything
  still waiting. Nothing reaches the shop before it's approved; the creator
  is told either way and gets their Edvie for free when it's approved.
* **Creator ranks**: 5 approved Edvies make you **Creator Rank I**, every 5
  more is a rank up to **Rank X** at 50, and 55 or more is **Creator
  Grandmaster**. The rank is shown on your Moggmeter card, after your name on
  every Edvie you made ("🎨 by Elon Musk (III)"), and the approval message tells
  you when you rank up. `creatorRank()` in `src/edvie.js`.
* **Cards** are rendered images (`src/edvieImage.js`): the rarity's colour as
  background, the sprite, the name and specs. That's what the shop, the
  collection and inline mode show.
* **Coins**: +25 for winning a Moggduel, +40 for winning an Edvie battle, once
  per opponent per kind per day (no farming with a friend). Spent in the
  shop. Amounts are `coinsPerWin` in `src/config.js`.
* **Shop and collection** in the bot's chat: `/shop`, `/collection`,
  `/edvies` (coins and everything else). One card at a time with ◀️ ▶️.
* **Edvie battles**: someone sends an Edvie into a chat; anyone else taps
  **⚔️ Battle**, picks one of their own Edvies (inline, each with its specs)
  or **🎲 Random fighter**, and presses **⚔️ Fight!**. The faster Edvie strikes first (a coin flip on equal
  Speed), then they take turns: a hit is a quarter of the attacker's Damage
  ±20%, one in ten is a critical ×1.5. Each Fight message is fought once; the
  Battle button can be used again and again.
  * **Resting**: an Edvie that fought (attacking or defending) sits out its
    trainer's next 3 battles, or fewer if they own fewer Edvies: with one
    Edvie it never rests, with two they alternate. So there's always one that
    can fight, and nobody wins everything with their single best Edvie.
    Resting Edvies aren't offered when picking, and a resting one that's
    been challenged says so. `edvieRestBattles` in `src/config.js`.
* **The Edvies app** (Mini App, optional): the collection and the shop as a
  grid of cards coloured by rarity, with buying and "send to a chat". It
  opens from the bot's menu button, `/edvies`, and the button above inline
  results.

### Hosting the Edvies app

Telegram only opens Mini Apps over **HTTPS**. The bot serves the app itself
on `WEBAPP_PORT` (8080); put an HTTPS address in front of it and set
`WEBAPP_URL` to that address:

* **Server with a domain**: a reverse proxy with automatic TLS, e.g. Caddy:
  `edvies.example.com { reverse_proxy localhost:8080 }`.
* **Quick test**: `cloudflared tunnel --url http://localhost:8080` prints a
  temporary `https://….trycloudflare.com` address (it changes every run).

Without `WEBAPP_URL` everything else works; the app buttons just don't appear.

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

`/start`, `/me`, `/edvies`, `/shop`, `/collection`, `/newedvie`, `/fix`,
`/help`, `/cancel`. Developers also get `/review`.

Sprites are stored next to the database, in `edvies/` inside `DB_PATH`'s
folder. Back that folder up together with the database.
