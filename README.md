# The Imposter

**Three innocents share a secret word. One impostor fakes it. Everyone speaks. Someone slips.**

The Imposter is a real-time online social-deduction game for 3–8 players (sweet spot: 4). The innocents and the impostor each see a *different but related* word — then the group takes **3 rotations** where everyone says exactly **one clue word**. Then everyone votes. Catch the impostor and they get *one* final chance to steal the win by guessing the true word.

## How a round works
1. **Words** — innocents see the secret word, the impostor sees a sibling (e.g. `Chai` vs `Coffee`, `Mango` vs `Banana`, `Virat Kohli` vs `Rohit Sharma`).
2. **Clues** — in turn order, each player names one word about what they see. No repeats, nothing containing the secret words.
3. **Vote** — after 3 full rotations, everyone votes out one player (not themselves).
   - Wrong player caught → **impostor wins instantly**.
   - Tied vote → **impostor escapes**.
   - Impostor caught → **final gamble**: they may guess the real word. Right → they steal the win. Wrong → innocents win.
4. **Score** — innocents get +1 each on a clean catch; the impostor gets +2 whenever they win. Play again and the roles reshuffle.

## Play alone (bot mode)
In the lobby the host can press **+ Add a bot** to fill seats with AI players. Bots give themed clues for the word they see, vote by analysing who's clues fit the word — and a caught bot-impostor takes the final gamble with a 25% chance to steal the word. Solo works fine with any player count of bots.

## Party mode (one phone)
The reel-way to play: pick **Party mode** on the home screen. Add your friends' names, pass the phone around once so everyone secretly sees their word, then clamp the phone in the middle — the app announces whose turn it is and players say their clues **out loud** (optional pressure timer), then everyone takes a secret vote by passing the phone. No extra apps, no accounts, works in a car, a hostel, a chai stall.

## Run locally
```bash
npm install
npm start
# open http://localhost:3000 in a browser on each player's device
```

## Run the multiplayer simulation tests
```bash
npm test
```
Boots the real server, connects scripted clients over websockets, and plays full games end-to-end: innocents win, impostor wins via a failed catch, a fully automated solo round with 2 bots, join errors, duplicate clues, round cycling.

## Project structure
```
├── START GAME.bat      double-click → starts the server and opens the game
├── package.json        scripts (npm start / npm test) and dependencies
├── server.js           the game authority: rooms, bots, voice signaling, https door
├── data/
│   ├── wordpairs.js    the 41 secret-word pairs (add new pairs here)
│   └── botclues.js     themed clue pools for every word (bots pick hints from here)
├── public/             everything the browser loads
│   ├── index.html      the single page
│   ├── style.css       the champagne-gold look
│   ├── app.js          online client + one-phone party mode + voice chat UI
│   └── pairs.js        auto-generated word snapshot for offline play (rebuilt at every start)
└── test/               6 test suites: game engine, browser flow, offline mode, voice ×3
```
Adding words: append a pair in `data/wordpairs.js` and a clue line for both words in `data/botclues.js` — everything else (partner map, API, offline snapshot) updates automatically.

## Deploy
Any Node host works (Render, Railway, Fly.io...):
- Build command: `npm install`
- Start command: `npm start`

No database, no build step — all room state lives in memory per server instance.

## Stack
Node.js + Express + Socket.io (server-authoritative room state) · vanilla JS + tiny hand-rolled CSS on the client.

## License
MIT
