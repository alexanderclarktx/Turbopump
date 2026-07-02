export function ansiClassForCode(code) {
  const colors = {
    30: "black",
    31: "red",
    32: "green",
    33: "yellow",
    34: "blue",
    35: "magenta",
    36: "cyan",
    37: "white",
    90: "bright-black",
    91: "bright-red",
    92: "bright-green",
    93: "bright-yellow",
    94: "bright-blue",
    95: "bright-magenta",
    96: "bright-cyan",
    97: "bright-white",
  };
  return colors[code] ? `ansi-fg-${colors[code]}` : "";
}

export function ansiColorValueForCode(code) {
  const colors = {
    30: "#111827",
    31: "#b91c1c",
    32: "#15803d",
    33: "#a16207",
    34: "#1d4ed8",
    35: "#a21caf",
    36: "#0e7490",
    37: "#475569",
    90: "#64748b",
    91: "#dc2626",
    92: "#16a34a",
    93: "#ca8a04",
    94: "#2563eb",
    95: "#c026d3",
    96: "#0891b2",
    97: "#334155",
  };
  return colors[code] || "";
}

export function ansi256ColorValue(value) {
  const color = Number(value);
  if (!Number.isInteger(color) || color < 0 || color > 255) return "";
  const base = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  if (color < base.length) return base[color];
  if (color >= 232) {
    const level = 8 + (color - 232) * 10;
    return `rgb(${level}, ${level}, ${level})`;
  }
  const index = color - 16;
  const channel = (step) => (step === 0 ? 0 : 55 + step * 40);
  const red = channel(Math.floor(index / 36) % 6);
  const green = channel(Math.floor(index / 6) % 6);
  const blue = channel(index % 6);
  return `rgb(${red}, ${green}, ${blue})`;
}

export function ansiTrueColorValue(red, green, blue) {
  const channels = [red, green, blue].map(Number);
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return "";
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

export function ansiParams(value) {
  if (!value) return [0];
  const params = String(value)
    .split(/[;:]/)
    .filter((item) => item !== "")
    .map((item) => Number(item));
  return params.length ? params : [0];
}

export function renderAnsiText(root, message) {
  const text = String(message || "");
  const pattern = /\x1b\[([0-?]*)([ -/]*)([@-~])|\[((?:\d{1,3}|[;:])+)m/g;
  let index = 0;
  let colorClass = "";
  let inlineColor = "";
  let backgroundColor = "";
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;

  const appendText = (value) => {
    if (!value) return;
    if (!colorClass && !inlineColor && !backgroundColor && !bold && !dim && !italic && !underline) {
      root.appendChild(document.createTextNode(value));
      return;
    }
    const span = document.createElement("span");
    if (colorClass) span.classList.add(colorClass);
    if (bold) span.classList.add("ansi-bold");
    if (dim) span.classList.add("ansi-dim");
    if (italic) span.classList.add("ansi-italic");
    if (underline) span.classList.add("ansi-underline");
    if (inlineColor) span.style.color = inlineColor;
    if (backgroundColor) span.style.backgroundColor = backgroundColor;
    span.textContent = value;
    root.appendChild(span);
  };

  for (const match of text.matchAll(pattern)) {
    appendText(text.slice(index, match.index));
    index = match.index + match[0].length;
    const command = match[3] || "m";
    if (command !== "m") continue;
    const params = ansiParams(match[1] || match[4] || "0");
    for (let paramIndex = 0; paramIndex < params.length; paramIndex += 1) {
      const code = params[paramIndex];
      if (code === 0) {
        colorClass = "";
        inlineColor = "";
        backgroundColor = "";
        bold = false;
        dim = false;
        italic = false;
        underline = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 3) {
        italic = true;
      } else if (code === 4) {
        underline = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 23) {
        italic = false;
      } else if (code === 24) {
        underline = false;
      } else if (code === 39) {
        colorClass = "";
        inlineColor = "";
      } else if (code === 49) {
        backgroundColor = "";
      } else if (code >= 40 && code <= 47) {
        backgroundColor = ansiColorValueForCode(code - 10);
      } else if (code >= 100 && code <= 107) {
        backgroundColor = ansiColorValueForCode(code - 10);
      } else if ((code === 38 || code === 48) && params[paramIndex + 1] === 5) {
        const nextColor = ansi256ColorValue(params[paramIndex + 2]);
        if (nextColor) {
          if (code === 38) {
            colorClass = "";
            inlineColor = nextColor;
          } else {
            backgroundColor = nextColor;
          }
        }
        paramIndex += 2;
      } else if ((code === 38 || code === 48) && params[paramIndex + 1] === 2) {
        const nextColor = ansiTrueColorValue(params[paramIndex + 2], params[paramIndex + 3], params[paramIndex + 4]);
        if (nextColor) {
          if (code === 38) {
            colorClass = "";
            inlineColor = nextColor;
          } else {
            backgroundColor = nextColor;
          }
        }
        paramIndex += 4;
      } else {
        const nextColorClass = ansiClassForCode(code);
        if (nextColorClass) {
          colorClass = nextColorClass;
          inlineColor = "";
        }
      }
    }
  }
  appendText(text.slice(index));
}
