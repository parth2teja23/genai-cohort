import React, { useRef, useState } from "react";

/* ===============================
   Syllable splitter (heuristic)
   =============================== */

const VOWELS = "aeiou";
const DIPHTHONGS = new Set([
  "ai","au","ea","ee","ei","eu","ie","oa","oe","oi","oo","ou","ue","ui"
]);
const COMMON_PREFIXES = [
  "anti","auto","bi","co","de","dis","en","em","ex","extra","hyper","il","im","in",
  "inter","ir","micro","mid","mis","mono","non","over","pre","post","re","semi","sub",
  "super","tele","trans","tri","ultra","un","under"
];
const COMMON_SUFFIXES = [
  "able","ible","age","al","ance","ence","ant","ent","ary","ery","ed","er","est","ful",
  "hood","ing","ion","tion","ation","ity","ive","less","ly","ment","ness","ous","ship",
  "sion","ward","wise","y"
];

function isVowel(ch, i, word) {
  if (!ch) return false;
  ch = ch.toLowerCase();
  if (VOWELS.includes(ch)) return true;
  if (ch !== "y") return false;
  const prev = word[i - 1]?.toLowerCase() || "";
  const next = word[i + 1]?.toLowerCase() || "";
  const prevIsLetter = /[a-z]/.test(prev);
  const nextIsLetter = /[a-z]/.test(next);
  const prevIsV = prevIsLetter && (VOWELS + "y").includes(prev);
  const nextIsV = nextIsLetter && (VOWELS + "y").includes(next);
  // treat 'y' as vowel when between consonants
  return prevIsLetter && nextIsLetter && !prevIsV && !nextIsV;
}

function syllabifyWord(raw) {
  const lower = raw.toLowerCase();
  if (!/^[a-z]+$/.test(lower)) return [raw]; // leave non-alpha to caller

  // 1) peel a common prefix/suffix (greedy but safe lengths)
  let start = 0, end = lower.length;
  let pre = "", suf = "";

  const pref = COMMON_PREFIXES.find(p => lower.startsWith(p) && lower.length - p.length >= 2);
  if (pref) { pre = raw.slice(0, pref.length); start = pref.length; }

  const suff = COMMON_SUFFIXES.find(s => lower.endsWith(s) && (end - start - s.length) >= 2);
  if (suff) { suf = raw.slice(end - suff.length); end -= suff.length; }

  const core = raw.slice(start, end);
  if (core.length === 0) return [pre || raw, suf].filter(Boolean);

  // 2) split core by greedy vowel groups with VCCV rule
  const coreLower = lower.slice(start, end);
  const chars = Array.from(core);
  const charsLower = Array.from(coreLower);
  const syl = [];
  let i = 0;

  while (i < chars.length) {
    let j = i;

    // ensure syllable has at least one vowel
    if (!isVowel(charsLower[j], j, coreLower)) {
      j++;
      while (j < chars.length && !isVowel(charsLower[j], j, coreLower)) j++;
    }
    if (j < chars.length) {
      // consume vowel/diphthong
      let k = j + 1;
      const pair = (charsLower[j] + (charsLower[j + 1] || ""));
      if (DIPHTHONGS.has(pair)) k = j + 2;

      // consume following consonants, but keep one for next syllable in VCCV
      let c = k;
      while (c < chars.length && !isVowel(charsLower[c], c, coreLower)) c++;

      if (c - k >= 2) c = k + 1; // VCCV -> VC|CV

      syl.push(chars.slice(i, c).join(""));
      i = c;
    } else {
      syl.push(chars.slice(i).join(""));
      break;
    }
  }

  const out = [];
  if (pre) out.push(pre);
  out.push(...syl);
  if (suf) out.push(suf);
  return out;
}

/** Split a full string into syllable tokens, keeping non-letters (spaces, punctuation, digits) as tokens */
function syllabify(text) {
  const tokens = [];
  let current = "";

  function flush() {
    if (!current) return;
    const parts = syllabifyWord(current);
    // approximate mapping back to original casing by slicing lengths
    let idx = 0;
    for (const p of parts) {
      tokens.push(current.slice(idx, idx + p.length));
      idx += p.length;
    }
    current = "";
  }

  for (const ch of text) {
    if (/[A-Za-z]/.test(ch)) current += ch;
    else { flush(); tokens.push(ch); }
  }
  flush();
  return tokens.filter(t => t !== "");
}

/* ===============================
   Minimal tokenizer using syllables
   =============================== */

class SyllableTokenizer {
  constructor() {
    this.t2i = new Map();
    this.i2t = new Map();
    this.nextId = 0;
  }
  _ensure(t) {
    if (!this.t2i.has(t)) {
      const id = this.nextId++;
      this.t2i.set(t, id);
      this.i2t.set(id, t);
    }
    return this.t2i.get(t);
  }
  encode(text) { return syllabify(text).map(t => this._ensure(t)); }
  decode(ids)  { return ids.map(n => this.i2t.get(Number(n)) ?? "<UNK>").join(""); }
  reset()      { this.t2i.clear(); this.i2t.clear(); this.nextId = 0; }
}

/* ===============================
   React UI (minimal, dark)
   =============================== */

export default function App() {
  const tokRef = useRef(new SyllableTokenizer());
  const tok = tokRef.current;

  const [text, setText] = useState("unbeatable vs unbelievable!");
  const [ids, setIds] = useState([]);
  const [decoded, setDecoded] = useState("");

  const onEncode = () => setIds(tok.encode(text));
  const onDecode = () => setDecoded(tok.decode(ids));
  const onReset  = () => { tok.reset(); setIds([]); setDecoded(""); };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Syllable Tokenizer</h1>
            <p className="text-sm text-zinc-400">Uses syllables (e.g., <code>un-beat-able</code>) with encode/decode.</p>
          </div>
        </header>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400">Text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="h-36 w-full rounded-md border border-zinc-800 bg-black p-2 text-sm outline-none focus:ring-1 focus:ring-zinc-700"
                placeholder="Type something like: unbeatable unbelievable"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={onEncode}
                  className="rounded-md border border-zinc-800 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-zinc-100"
                >
                  Encode → IDs
                </button>
                <button
                  onClick={onDecode}
                  className="rounded-md border border-zinc-800 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-zinc-100"
                >
                  Decode IDs → Text
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-zinc-400">IDs</label>
              <textarea
                value={ids.join(", ")}
                onChange={(e) => {
                  const nums = (e.target.value.match(/-?\d+/g) || []).map(Number);
                  setIds(nums);
                }}
                className="h-36 w-full rounded-md border border-zinc-800 bg-black p-2 text-xs font-mono outline-none focus:ring-1 focus:ring-zinc-700"
                placeholder="Encoded IDs appear here… (you can edit)"
              />

              <label className="mb-1 mt-3 block text-xs text-zinc-400">Decoded text</label>
              <div className="min-h-[6rem] rounded-md border border-zinc-800 bg-black p-2 text-sm">
                {decoded}
              </div>
            </div>
          </div>
        </section>

        <div className="mt-4 text-md text-zinc-500">
          Tip: Non-letters (spaces, punctuation, digits) are kept as separate tokens so round-trip text is preserved.
        </div>
        <div className="mt-4 text-xs text-zinc-500 text-center">
          A GenAI cohort project built by <span className="font-semibold text-blue-500"><a target="_blank" href="https://www.parth2teja.in">parth2teja</a></span>. Yes, I vibe coded :) 
        </div>
      </div>
    </div>
  );
}
