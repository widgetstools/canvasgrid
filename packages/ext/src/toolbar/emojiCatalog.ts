// Curated emoji set for the ribbon icon picker — 8 categories, common
// finance/status/UI glyphs first. Hand-maintained (no build step; the
// full Unicode set would drown the picker).

export const emojiCategories: ReadonlyArray<{ readonly category: string; readonly emojis: readonly string[] }> = [
  { category: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🙂', '😉', '😊', '😍', '🤩', '😎', '🤔', '😐', '😬', '🙄', '😴', '🤯', '😱', '😢', '😡', '🥳', '🤗', '🫡'] },
  { category: 'Gestures & People', emojis: ['👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '🤝', '💪', '🫵', '👉', '👈', '👆', '👇', '✋', '🖐️', '👋', '🤙', '🙏', '💁', '🙋', '🤷', '🏃', '🧍'] },
  { category: 'Arrows', emojis: ['⬆️', '⬇️', '⬅️', '➡️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↩️', '↪️', '⤴️', '⤵️', '🔼', '🔽', '⏫', '⏬', '🔄', '🔁', '🔀', '◀️', '▶️', '⏸️'] },
  { category: 'Symbols & Status', emojis: ['✅', '❌', '⚠️', '❗', '❓', '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⭐', '🌟', '✨', '🚫'] },
  { category: 'Finance', emojis: ['💰', '💵', '💴', '💶', '💷', '💸', '💳', '🪙', '🏦', '📈', '📉', '📊', '🧾', '💹', '🤑', '🏧', '💲', '🛒', '🛍️', '📦', '🏷️', '⚖️', '🗃️', '💼'] },
  { category: 'Objects & Tech', emojis: ['💻', '🖥️', '⌨️', '🖱️', '📱', '☎️', '🖨️', '💾', '📡', '🔋', '🔌', '💡', '🔦', '🔧', '🔨', '⚙️', '🧲', '🔒', '🔓', '🔑', '📌', '📎', '✂️', '🗑️'] },
  { category: 'Time & Weather', emojis: ['⏰', '⏱️', '⏳', '⌛', '🕐', '📅', '🗓️', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '🌩️', '❄️', '🌪️', '🌈', '🌙', '🌡️', '💧', '🔥', '⚡', '🌊', '🌍', '🪐'] },
  { category: 'Nature & Food', emojis: ['🌱', '🌿', '🍀', '🌲', '🌴', '🌸', '🌻', '🍎', '🍊', '🍋', '🍇', '🍓', '🥑', '🍕', '🍔', '☕', '🍺', '🐝', '🦋', '🐟', '🐢', '🦅', '🐘', '🦁'] },
];
