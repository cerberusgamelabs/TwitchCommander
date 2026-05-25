const ACTION_ARGUMENT_LABELS = {
  mouse: {
    1: "x(0-100)",
    2: "y(0-100)",
    3: "button"
  },
  mousehold: {
    1: "x(0-100)",
    2: "y(0-100)",
    3: "button",
    4: "duration_ms"
  },
  mousedrag: {
    1: "start_x(0-100)",
    2: "start_y(0-100)",
    3: "end_x(0-100)",
    4: "end_y(0-100)",
    5: "button"
  },
  scroll: {
    1: "amount"
  },
  keytap: {
    1: "key",
    2: "times"
  },
  keyhold: {
    1: "key",
    2: "duration_ms"
  }
};

function getRequiredArgumentCount(commandDetails) {
  const actions = Array.isArray(commandDetails?.actions) ? commandDetails.actions : [];
  let highestIndex = 0;

  for (const action of actions) {
    const matches = String(action || "").matchAll(/\$([1-9]\d*)(\?([^|]+))?/g);
    for (const match of matches) {
      const index = Number(match[1]);
      const hasFallback = match[3] !== undefined;
      if (hasFallback) {
        continue;
      }
      if (Number.isFinite(index) && index > highestIndex) {
        highestIndex = index;
      }
    }
  }

  return highestIndex;
}

function hasArgumentPlaceholders(commandDetails) {
  const actions = Array.isArray(commandDetails?.actions) ? commandDetails.actions : [];
  return actions.some((action) => /\$([1-9]\d*)(\?([^|]+))?/.test(String(action || "")));
}

function getRequiredArgumentLabels(commandDetails) {
  const labels = new Map();
  const actions = Array.isArray(commandDetails?.actions) ? commandDetails.actions : [];

  for (const action of actions) {
    const parts = String(action || "").split("|");
    const actionLabels = ACTION_ARGUMENT_LABELS[parts[0]] || {};

    for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
      const match = /^\$([1-9]\d*)(\?([^|]+))?$/.exec(String(parts[partIndex] || "").trim());
      if (!match || match[3] !== undefined) {
        continue;
      }

      const argIndex = Number(match[1]);
      if (!Number.isFinite(argIndex) || labels.has(argIndex)) {
        continue;
      }

      labels.set(argIndex, actionLabels[partIndex] || `arg${argIndex}`);
    }
  }

  return labels;
}

function getOptionalArgumentLabels(commandDetails) {
  const labels = new Map();
  const actions = Array.isArray(commandDetails?.actions) ? commandDetails.actions : [];

  for (const action of actions) {
    const parts = String(action || "").split("|");
    const actionLabels = ACTION_ARGUMENT_LABELS[parts[0]] || {};

    for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
      const match = /^\$([1-9]\d*)(\?([^|]+))?$/.exec(String(parts[partIndex] || "").trim());
      if (!match || match[3] === undefined) {
        continue;
      }

      const argIndex = Number(match[1]);
      if (!Number.isFinite(argIndex) || labels.has(argIndex)) {
        continue;
      }

      labels.set(argIndex, actionLabels[partIndex] || `arg${argIndex}`);
    }
  }

  return labels;
}

function buildArgumentTokens(commandDetails) {
  const requiredArgCount = getRequiredArgumentCount(commandDetails);
  const requiredLabels = getRequiredArgumentLabels(commandDetails);
  const optionalLabels = getOptionalArgumentLabels(commandDetails);
  const tokens = [];

  const allIndexes = new Set();
  for (let index = 1; index <= requiredArgCount; index += 1) {
    allIndexes.add(index);
  }
  for (const index of optionalLabels.keys()) {
    allIndexes.add(index);
  }

  for (const index of Array.from(allIndexes).sort((a, b) => a - b)) {
    if (index <= requiredArgCount) {
      tokens.push(`<${requiredLabels.get(index) || `arg${index}`}>`);
      continue;
    }

    tokens.push(`[${optionalLabels.get(index) || `arg${index}`}]`);
  }

  return tokens;
}

function buildCommandUsage(trigger, commandKey, commandDetails) {
  const commandName = String(commandDetails?.name || commandKey || "").trim();
  return [String(trigger || "!") + commandName, ...buildArgumentTokens(commandDetails)].join(" ");
}

function buildArgumentSuffix(commandDetails) {
  const tokens = buildArgumentTokens(commandDetails);
  return tokens.length ? ` ${tokens.join(" ")}` : "";
}

module.exports = {
  buildArgumentSuffix,
  buildCommandUsage,
  buildArgumentTokens,
  hasArgumentPlaceholders,
  getRequiredArgumentCount,
  getRequiredArgumentLabels
};
