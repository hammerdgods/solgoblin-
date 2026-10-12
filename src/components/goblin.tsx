/**
 * SolGoblin mascot — an original cartoon goblin drawn as inline SVG
 * (no external assets). Decorative only.
 */

export function GoblinMascot({ className = "h-72 w-72" }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 280" className={className} role="img" aria-label="SolGoblin mascot: a grinning cartoon goblin holding a gold coin">
      <defs>
        <linearGradient id="gb-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ee8a8" />
          <stop offset="1" stopColor="#3cb873" />
        </linearGradient>
        <linearGradient id="gb-hat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f1a5" />
        </linearGradient>
        <linearGradient id="gb-hoodie" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b3640" />
          <stop offset="1" stopColor="#161d23" />
        </linearGradient>
        <radialGradient id="gb-coin" cx="0.38" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fff2a8" />
          <stop offset="0.55" stopColor="#f5c542" />
          <stop offset="1" stopColor="#c48a12" />
        </radialGradient>
        <radialGradient id="gb-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#4fd18b" stopOpacity="0.35" />
          <stop offset="1" stopColor="#4fd18b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* glow + shadow */}
      <circle cx="130" cy="140" r="128" fill="url(#gb-glow)" />
      <ellipse cx="130" cy="268" rx="70" ry="8" fill="#000" opacity="0.35" />

      {/* body / hoodie */}
      <path d="M68 270 C66 222 92 196 130 196 C168 196 194 222 192 270 Z" fill="url(#gb-hoodie)" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <path d="M112 200 L130 226 L148 200" fill="none" stroke="#4fd18b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* ears */}
      <path d="M62 110 C38 98 14 72 6 50 C32 58 60 72 80 92 Z" fill="url(#gb-skin)" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <path d="M58 102 C42 92 28 76 22 64 C38 70 54 80 68 94 Z" fill="#e88aa4" opacity="0.7" />
      <path d="M198 110 C222 98 246 72 254 50 C228 58 200 72 180 92 Z" fill="url(#gb-skin)" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <path d="M202 102 C218 92 232 76 238 64 C222 70 206 80 192 94 Z" fill="#e88aa4" opacity="0.7" />

      {/* head */}
      <path d="M130 52 C178 52 206 88 204 128 C202 172 170 204 130 204 C90 204 58 172 56 128 C54 88 82 52 130 52 Z" fill="url(#gb-skin)" stroke="#0b0f12" strokeWidth="4" />
      {/* cheeks */}
      <ellipse cx="82" cy="150" rx="13" ry="8" fill="#e88aa4" opacity="0.55" />
      <ellipse cx="178" cy="150" rx="13" ry="8" fill="#e88aa4" opacity="0.55" />

      {/* beanie */}
      <path d="M70 92 C74 50 102 30 130 30 C158 30 186 50 190 92 C160 82 100 82 70 92 Z" fill="url(#gb-hat)" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <path d="M66 94 C100 80 160 80 194 94 L192 108 C160 96 100 96 68 108 Z" fill="#1c2329" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="130" cy="26" r="11" fill="#14f1a5" stroke="#0b0f12" strokeWidth="4" />

      {/* brows (mischievous) */}
      <path d="M86 116 C96 108 110 108 118 116" fill="none" stroke="#0b0f12" strokeWidth="5" strokeLinecap="round" />
      <path d="M142 112 C152 104 168 106 176 116" fill="none" stroke="#0b0f12" strokeWidth="5" strokeLinecap="round" />

      {/* eyes */}
      <g className="goblin-eyes">
        <ellipse cx="103" cy="134" rx="17" ry="19" fill="#fff" stroke="#0b0f12" strokeWidth="4" />
        <ellipse cx="159" cy="134" rx="17" ry="19" fill="#fff" stroke="#0b0f12" strokeWidth="4" />
        <circle cx="108" cy="137" r="8" fill="#0b0f12" />
        <circle cx="164" cy="137" r="8" fill="#0b0f12" />
        <circle cx="111" cy="133" r="3" fill="#fff" />
        <circle cx="167" cy="133" r="3" fill="#fff" />
      </g>

      {/* nose */}
      <path d="M130 140 C140 146 146 158 138 164 C133 167 126 166 122 162" fill="#5fd393" stroke="#0b0f12" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* grin with fangs */}
      <path d="M94 172 C110 192 150 192 168 170 C150 178 112 180 94 172 Z" fill="#3a1220" stroke="#0b0f12" strokeWidth="4" strokeLinejoin="round" />
      <path d="M108 177 L113 188 L118 179 Z" fill="#fff" stroke="#0b0f12" strokeWidth="2" strokeLinejoin="round" />
      <path d="M144 179 L149 188 L154 176 Z" fill="#fff" stroke="#0b0f12" strokeWidth="2" strokeLinejoin="round" />

      {/* arm + gold SOL coin */}
      <path d="M182 232 C196 222 204 210 206 198" fill="none" stroke="#0b0f12" strokeWidth="16" strokeLinecap="round" />
      <path d="M182 232 C196 222 204 210 206 198" fill="none" stroke="url(#gb-skin)" strokeWidth="9" strokeLinecap="round" />
      <g className="goblin-coin">
        <circle cx="212" cy="182" r="26" fill="url(#gb-coin)" stroke="#0b0f12" strokeWidth="4" />
        <circle cx="212" cy="182" r="18" fill="none" stroke="#c48a12" strokeWidth="2.5" />
        <text x="212" y="191" textAnchor="middle" fontSize="26" fontWeight="800" fill="#8a5a00" fontFamily="ui-sans-serif, system-ui">◎</text>
      </g>
      {/* sparkles */}
      <path d="M232 140 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill="#fff2a8" />
      <path d="M244 210 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#fff2a8" opacity="0.8" />
    </svg>
  );
}

/** Small goblin head used as the logo mark. */
export function GoblinHead({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0f1a14" />
      <path d="M17 30 C10 27 5 20 3 14 C10 16 17 20 22 25 Z" fill="#5fd393" stroke="#0b0f12" strokeWidth="2" strokeLinejoin="round" />
      <path d="M47 30 C54 27 59 20 61 14 C54 16 47 20 42 25 Z" fill="#5fd393" stroke="#0b0f12" strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 14 C44 14 51 23 50 33 C50 45 42 53 32 53 C22 53 14 45 14 33 C13 23 20 14 32 14 Z" fill="#5fd393" stroke="#0b0f12" strokeWidth="2" />
      <path d="M17 24 C18 13 25 8 32 8 C39 8 46 13 47 24 C40 21 24 21 17 24 Z" fill="#9945ff" stroke="#0b0f12" strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="25.5" cy="33" rx="5" ry="5.5" fill="#fff" stroke="#0b0f12" strokeWidth="1.5" />
      <ellipse cx="38.5" cy="33" rx="5" ry="5.5" fill="#fff" stroke="#0b0f12" strokeWidth="1.5" />
      <circle cx="27" cy="34" r="2.4" fill="#0b0f12" />
      <circle cx="40" cy="34" r="2.4" fill="#0b0f12" />
      <path d="M23 43 C28 48 36 48 41 42 C36 44 28 45 23 43 Z" fill="#3a1220" stroke="#0b0f12" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M27 44 L28.5 47 L30 44.5 Z" fill="#fff" />
      <path d="M35 44.5 L36.5 47 L38 44 Z" fill="#fff" />
    </svg>
  );
}
