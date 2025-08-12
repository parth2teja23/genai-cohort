# Syllable Tokenizer (React + Tailwind)

A lightweight **syllable-based tokenizer** that runs entirely in the browser.  
It uses a **heuristic syllable splitter** for English words, keeps non-letters as separate tokens, and supports **encode → IDs** and **decode → text**.

---

## Features

- **Heuristic syllable splitting**:
  - Handles common English prefixes and suffixes.
  - Recognizes diphthongs (e.g., `ea`, `oo`, `ou`).
  - Uses VCCV rule for splitting consonant clusters.
  - Treats `y` as a vowel when between consonants.
- **Keeps spaces, punctuation, and digits** as separate tokens (round-trip safe).
- **On-the-fly vocab learning**:
  - Each token gets a unique ID when first seen.
  - Same session → same IDs.
  - Unknown IDs decode to `<UNK>`.
- **Minimal, dark UI** using React + TailwindCSS.

---

## How It Works

### 1. Syllable Splitting
The tokenizer breaks each **word** into syllable-like chunks using a small set of rules:

- Detects common **prefixes** (`un`, `pre`, `inter`, etc.) and **suffixes** (`able`, `ing`, `tion`, etc.).
- Recognizes vowel groups and **diphthongs**.
- Applies the **VCCV rule**: in `VC-CV`, the split happens between the consonants (e.g., `hap-py`).
- Treats `y` as a vowel if surrounded by consonants.

Example:
```
"unbeatable" → ["un", "beat", "able"]
"unbelievable!" → ["un", "be", "liev", "able", "!"]
```

### 2. Vocab Learning
- Each token gets a new ID the first time it appears.
- Mapping is kept in memory (`Map` objects) for the session.
- IDs are incremental integers starting at 0.

### 3. Encode / Decode
- **Encode**: text → tokens → IDs.
- **Decode**: IDs → tokens → joined string (unknown IDs = `<UNK>`).

---

## Example

```
Input text: "unbeatable vs unbelievable!"
Tokens: ["un","beat","able"," ","vs"," ","un","be","liev","able","!"]
IDs:    [0,1,2,3,4,5,0,6,7,2,8]
Decoded: "unbeatable vs unbelievable!"
```

---

## Quick Start

### 1. Create project (Vite + React)
```bash
npm create vite@latest syllable-tokenizer
cd syllable-tokenizer
npm install
```

### 2. Install TailwindCSS
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### 3. Configure Tailwind (`tailwind.config.js`)
```js
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
```

### 4. Add styles in `src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 5. Replace `src/App.jsx` with the provided syllable tokenizer code.

### 6. Run
```bash
npm run dev
```

---

## UI Overview

- **Text** box → Input your sentence to tokenize.
- **Encode** button → Produces numeric IDs from text.
- **IDs** box → Shows IDs, editable (you can paste new IDs here).
- **Decode** button → Converts IDs back to text.
- **Reset Vocab** → Clears learned token-ID mapping.

---

## Limitations

- Heuristic only — not perfect for all English words.
- Vocab is in-memory only; refresh clears it (can be extended with `localStorage`).
- Unknown IDs are shown as `<UNK>` when decoding.

---

## License

MIT © 2025 Parth Tuteja
