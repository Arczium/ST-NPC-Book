> 🌐 **Languages / Sprachen:** **English** (current) | [Deutsch](locales/README.de.md)

# ST-NPC-Book

**ST-NPC-Book** is an automated character state and roster management extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern). Designed primarily for **multi-character cards, open-world RPGs, Narrator/GM setups, and slow-burn campaigns**, it automatically extracts, creates, and updates **individual, keyword-triggered Lorebook (World Info) entries for each NPC** in configurable message slices using a two-stage LLM pipeline.

---

## 💡 Motivation & Background (Why ST-NPC-Book?)

In long-form roleplay (hundreds of messages across an evolving cast of characters), static character definitions quickly become outdated. Relationships shift, characters change locations or attire, learn secrets, suffer injuries, or pursue new goals.

Previously, I used **ST-Memory-Books** with custom prompts to maintain an "NPC Diary" inside a Chat Lorebook. While that setup worked reasonably well, it suffered from a fundamental structural limitation: **all-or-nothing monolithic updates**.
- Because Memory Books processes a slice into a single entry (or requires rigid monolithic passes), either **every NPC was rewritten at once**, or **none of them were**.
- Packing 10–20 NPCs into a single constant Lorebook entry wastes massive amounts of context tokens on characters who aren't even in the current scene, and causes the LLM to gradually compress or drop details for characters who haven't appeared in the last 30 messages.
- Conversely, only keeping individual static Lorebook entries means characters never evolve past their starting state.

**What ST-NPC-Book solves:**
1. **One Keyword-Triggered Lorebook Entry per NPC (`[NPC] {{name}}`):** Each character lives in their own dedicated World Info entry. If an NPC isn't mentioned in the current scene, their entry stays dormant and costs **zero tokens**. When their name or alias appears, their latest state is injected automatically.
2. **Targeted Updates Only (2-Stage Scanner + Scribe Pipeline):** Instead of rewriting the entire cast on every batch, **Stage 1 (Scanner)** inspects the new message slice alongside the currently tracked roster and identifies *only* the NPCs who actually appeared or changed. **Stage 2 (Scribe)** then runs parallel worker calls exclusively for those affected characters, leaving inactive NPCs untouched.
3. **Living State Snapshot (No Append-Only Bloat):** The Scribe agent is instructed to *overwrite* outdated states (current location, clothes, physical condition, attitude toward `{{user}}`, current objectives) rather than endlessly appending history logs.
4. **Atomic Execution & 1-Click Rollback:** If any API call in a slice fails or returns empty output, the entire slice aborts cleanly without advancing the scan cursor or corrupting the Lorebook. A built-in pre-slice snapshot lets you **Undo** or **Reroll** the last slice at any time.
5. **100% Configurable:** Everything can be tailored to your workflow—how many messages make up a scan slice, how many buffer messages to wait before triggering, which LLM Connection Profile/model runs the Scanner vs. the Scribe, how many Scribe workers run in parallel, all World Info injection parameters (Position, Depth, Scan Depth, Sticky, Order), and all system prompts and output templates.

---

## ⚙️ How the 2-Stage Pipeline Works

Every **`Message Slice Interval`** messages (e.g., every 30 messages, plus a configurable **`Buffer Offset`** of e.g. 10 messages so the active scene can settle first), `ST-NPC-Book` processes the unscanned chat slice (`last_scanned_index .. last_scanned_index + interval`):

1. **Stage 1 — Scanner Agent (JSON Roster Detection):**
   - Receives a compact JSON list of all currently tracked `[NPC]` entries (`uid`, `name`, `keys`) and the raw chat transcript slice.
   - Outputs a strict `{ "update": [...], "create": [...] }` JSON payload listing which existing NPCs need a state update, which newly introduced recurring characters need a new profile created, and any new trigger keywords/aliases discovered.
2. **Stage 2 — Scribe Agent (Parallel Markdown Workers):**
   - Spawns up to `Max Concurrent Scribe Workers` parallel LLM requests (one per queued NPC).
   - For **new NPCs**, generates a structured profile following your customizable Output Template.
   - For **existing NPCs**, reads their current Lorebook entry + the new transcript slice and updates their profile in place.
3. **Atomic Single-Write Upsert:**
   - Once all Scribe workers succeed, the extension sanitizes and merges the trigger keywords (automatically stripping `{{user}}`, duplicates, and 1-character noise), writes all updated/created entries into the bound Chat Lorebook in a single disk operation, records a rollback snapshot, and advances the chat scan cursor.

---

## 📦 Installation

1. Open **SillyTavern**.
2. Go to the **Extensions** panel (stacked blocks icon at the top) $\rightarrow$ **Install Extension**.
3. Paste the repository URL:
   ```text
   https://github.com/Arczium/ST-NPC-Book
   ```
4. Click **Install for all users** (or **Install just for me**) and reload SillyTavern (`F5`).
5. Open the **Extensions Menu** (magic wand icon next to the chat input bar) and click **NPC-Book** to open the control and configuration modal.

---

## 🛠️ Recommended Workflow: Preparing Existing Character Cards & Lorebooks

`ST-NPC-Book` shines brightest on **multi-character cards, RPG sandboxes, and open-world scenarios**. However, if you use it with an existing downloaded Character Card or World Lorebook that *already* contains static character bios, keep the following rule in mind:

> ⚠️ **Avoid Duplicate / Contradictory Character Definitions!**
> If an NPC's static biography stays inside the main Character Card (`Description` / `Scenario`) or in a static Lorebook entry *while* `ST-NPC-Book` also creates and updates a dynamic `[NPC] Name` entry for that same character, the LLM will see two competing versions of the character in the prompt (wasting tokens and causing consistency conflicts once the character evolves).

### Best Practice (5–10 Minute Setup Before a Long Campaign)
Because SillyTavern mixes worldbuilding, formatting rules, and character bios inside free-text fields, `ST-NPC-Book` intentionally does not auto-delete text from your original Character Cards. Instead, for the cleanest long-term results:

1. **Bind a Dedicated Chat Lorebook:** Start your chat, open **NPC-Book**, and click **Create & Bind New** (or let the popup create `~{{char}}_{{date}}` automatically).
2. **Seed Existing Characters Once into the Chat Lorebook:**
   - For any pre-existing main or side characters whose states should evolve over the campaign, manually create an entry in your bound Chat Lorebook titled `[NPC] CharacterName` (matching your `Entry Title Template`) with their name/aliases as keywords.
   - Copy their starting traits/biography into that `[NPC] CharacterName` entry (ideally formatted close to your NPC Output Template).
3. **Clean Up the Original Card / Static Lorebook:**
   - Remove the static character biography from the Character Card's `Description` (or disable/remove the duplicate static entry in the attached Character Lorebook) so the Character Card only holds world rules, narrator instructions, or setting lore.
   - *(Tip: Keep a backup or simply re-download the original card if you want to start a fresh playthrough from scratch later).*

From that point onward, the `[NPC] CharacterName` entry in your Chat Lorebook is the **single source of truth** and will automatically evolve as your story progresses.

---

## 🖥️ Settings & Controls Overview

Open the modal via the **Extensions Menu (Wand Icon) $\rightarrow$ NPC-Book**. All parameters are fully adjustable across three tabs:

### Tab 1: Schedule & Lorebook

#### General & Schedule Settings
| Setting | Default | Description |
| :--- | :--- | :--- |
| **Enable Automatic NPC Scanning** | `On` | Automatically triggers a scan after a new AI message renders once the message threshold is reached. |
| **Show Toast Notifications** | `On` | Shows status/progress toasts during scans (critical errors are always shown). |
| **Prompt When Chat Has No Lorebook** | `On` | Opens a 3-option dialog (*Create & Bind New*, *Bind Existing*, *Ignore for This Chat*) if no Chat Lorebook is bound when a scan is due. |
| **Interface Language** | `Auto` | Live UI language switcher (`Auto`, `English`, `Deutsch`) without reloading SillyTavern. |
| **Auto-Created Lorebook Name Format** | `~{{char}}_{{date}}` | Naming template when creating a new Chat Lorebook. |
| **Message Slice Interval** | `30` (1–500) | **How many messages are processed per scan slice** (e.g., `0..30`, `30..60`). |
| **Buffer Offset Before Triggering** | `10` (0–200) | **How many extra messages to wait past the slice end before scanning** (e.g., with Interval `30` + Offset `10`, messages `0..30` are scanned when the chat reaches message `#40`). |

#### Manual Controls & Rollback Actions
- ⚡ **Scan Eligible Slice Now:** Immediately scans the next unscanned message slice.
- ⏩ **Catch Up All Slices (N):** Sequentially processes all due slices in an existing long chat (switches to **Stop After Current Slice** while running so you can pause cleanly at any time).
- ↩️ **Undo Last Slice:** Reverts all modified `[NPC]` entries to their exact pre-slice state, deletes any newly created `[NPC]` entries from that slice, and rewinds the scan cursor.
- 🔄 **Reroll Last Slice:** Undoes the last slice and immediately re-scans the exact same message range.
- 🗑️ **Wipe NPCs & Reset to 0:** Deletes all managed `[NPC]` entries in the bound Chat Lorebook (leaving non-NPC entries untouched) and resets the scan cursor to `0`.

#### World Info Entry Defaults (Applied to Created/Updated NPCs)
| Setting | Default | Description |
| :--- | :--- | :--- |
| **Entry Title Template** | `[NPC] {{name}}` | Prefix/suffix format used to identify managed NPC entries in the Lorebook. |
| **Activation Strategy** | `Normal` | `Normal` (Keyword-Triggered), `Constant` (Always Active), or `Vectorized` (RAG). |
| **Insertion Position** | `Worldinfo after` | Where the entry is injected (`Worldinfo before/after`, `Author's Note before/after`, `In-Chat @ Depth`, `Top/Bottom of System Prompt`). |
| **In-Chat Depth / Role** | `Depth 10` / `System` | Only shown when Insertion Position is set to `In-Chat @ Depth`. |
| **Insertion Order** | `100` | Priority/order value within SillyTavern's World Info budget. |
| **Scan Depth** | `10` | How many recent chat messages SillyTavern scans for the NPC's trigger keywords. |
| **Sticky Duration (Turns)** | `0` | How many turns the NPC entry remains active after being triggered once. |
| **Ignore World Info Budget** | `Off` | Whether triggered NPC entries bypass SillyTavern's global World Info token cap. |

### Tab 2: LLM Agents
Assign dedicated [SillyTavern Connection Manager](https://docs.sillytavern.app/) profiles to each stage independently (or leave on `-- Active ST API / Default --`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Scanner Connection Profile** | `Active ST API` | API/model profile for Stage 1 JSON roster detection. |
| **Scanner Max Tokens / Temp** | `2000` / `0.1` | Token limit and sampling temperature for Stage 1. |
| **Scribe Connection Profile** | `Active ST API` | API/model profile for Stage 2 profile creation and updates. |
| **Max Concurrent Scribe Workers** | `3` (1–10) | How many NPC profiles Stage 2 generates/updates in parallel. |
| **Scribe Max Tokens / Temp** | `5000` / `0.3` | Token limit and sampling temperature for each Stage 2 worker call. |

### Tab 3: Prompts & Template
All four system prompts and templates can be freely edited and reset to factory defaults (`Reset Default`) at any time:
1. **Stage 1: Scanner System Prompt** (`prompt_scanning`)
2. **Stage 2: Scribe Creation System Prompt** (`prompt_creation`)
3. **Stage 2: Scribe Update System Prompt** (`prompt_updating`)
4. **NPC Profile Output Markdown Template** (`prompt_output_template`)

### Slash Command
You can also trigger scans manually from the chat input bar or via Quick Replies:
- `/npc-scan` — Scans the next eligible message slice.
- `/npc-scan <start> <end>` — Scans a custom message index range (e.g., `/npc-scan 0 30`).

---

## 🌍 Translations & Contributing New Languages

All UI labels, tooltips, popups, and toast notifications are stored as standalone JSON dictionaries inside the [`locales/`](locales/) folder (`locales/en.json` serves as the master template and automatic fallback).

**Want to translate `ST-NPC-Book` into your language?**
1. Grab [`locales/en.json`](locales/en.json), copy it to `locales/<your_lang_code>.json` (e.g., `fr.json`, `es.json`, `ja.json`), and translate the text values.
   - ⚠️ **Important:** Do **not** translate or alter placeholder variables inside double curly braces (such as `{{name}}`, `{{char}}`, `{{date}}`, `{{start}}`, `{{end}}`, `{{count}}`, `{{lorebook}}`, etc.) or HTML tags like `<code>...</code>`.
2. Open a Pull Request or Issue with your translated JSON file (and optionally add the language entry to `locales/languages.json`), and I will gladly integrate it!
3. Or simply open an Issue and request a language—note that if I generate a language myself that I don't speak natively, it will purely be an LLM-generated translation.

---

## 📜 License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the [LICENSE](LICENSE) file for details.
