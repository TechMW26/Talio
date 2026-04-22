function stripMarkdownCodeBlocks(text = '') {
    const trimmed = text.trim();
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
}

function tryParseJson(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function trimDanglingJson(text) {
    let result = text.trimEnd();
    let previous = null;

    while (result && result !== previous) {
        previous = result;
        result = result
            .replace(/,\s*$/, '')
            .replace(/:\s*$/, '')
            .replace(/[\[{]\s*$/, '')
            .replace(/,\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*$/, '')
            .trimEnd();
    }

    return result;
}

function closeIncompleteJson(fragment = '') {
    let result = fragment.trimEnd();
    const stack = [];
    let inString = false;
    let escaped = false;

    for (const char of result) {
        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            stack.push('}');
        } else if (char === '[') {
            stack.push(']');
        } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
            stack.pop();
        }
    }

    if (inString) {
        if (result.endsWith('\\')) {
            result = result.slice(0, -1);
        }
        result += '"';
    }

    result = trimDanglingJson(result);

    while (stack.length > 0) {
        result = result.replace(/,\s*$/, '');
        result += stack.pop();
    }

    return result;
}

function parseRecoveredJson(fragment = '') {
    const direct = tryParseJson(fragment);
    if (direct) {
        return direct;
    }

    let candidate = fragment.trim();
    let attempts = 0;

    while (candidate.length > 1 && attempts < 1500) {
        const repaired = closeIncompleteJson(candidate);
        const parsed = tryParseJson(repaired);
        if (parsed) {
            return parsed;
        }

        candidate = candidate.slice(0, -1).trimEnd();
        attempts += 1;
    }

    return null;
}

function extractStructuredFragment(source, startIndex) {
    const fragment = source.slice(startIndex).trimStart();
    if (!fragment || !['{', '['].includes(fragment[0])) {
        return null;
    }

    const stack = [fragment[0] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    let collected = '';

    for (const char of fragment) {
        collected += char;

        if (escaped) {
            escaped = false;
            continue;
        }

        if (inString) {
            if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{') {
            stack.push('}');
        } else if (char === '[') {
            stack.push(']');
        } else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) {
            stack.pop();
            if (stack.length === 0) {
                return collected;
            }
        }
    }

    return closeIncompleteJson(collected);
}

function sanitizeCandidate(candidate) {
    return candidate
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']')
        .replace(/[\r\t]+/g, ' ');
}

function tokenizeJsonLike(input) {
    const tokens = [];
    let index = 0;

    while (index < input.length) {
        const char = input[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        if ('{}[]:,'.includes(char)) {
            tokens.push({ type: char, raw: char });
            index += 1;
            continue;
        }

        if (char === '"') {
            let end = index + 1;
            let escaped = false;
            while (end < input.length) {
                const nextChar = input[end];
                if (escaped) {
                    escaped = false;
                } else if (nextChar === '\\') {
                    escaped = true;
                } else if (nextChar === '"') {
                    end += 1;
                    break;
                }
                end += 1;
            }

            tokens.push({ type: 'STRING', raw: input.slice(index, end) });
            index = end;
            continue;
        }

        const numberMatch = input.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (numberMatch) {
            tokens.push({ type: 'NUMBER', raw: numberMatch[0] });
            index += numberMatch[0].length;
            continue;
        }

        const literalMatch = input.slice(index).match(/^(true|false|null)/);
        if (literalMatch) {
            tokens.push({ type: literalMatch[1].toUpperCase(), raw: literalMatch[1] });
            index += literalMatch[1].length;
            continue;
        }

        tokens.push({ type: 'UNKNOWN', raw: char });
        index += 1;
    }

    return tokens;
}

function isValueToken(token) {
    return ['STRING', 'NUMBER', 'TRUE', 'FALSE', 'NULL', '{', '['].includes(token?.type);
}

function repairStructuralDelimiters(candidate) {
    const tokens = tokenizeJsonLike(candidate);
    if (tokens.length === 0) {
        return candidate;
    }

    const output = [];
    const stack = [];

    const pushValueContext = (type, parentContext = null) => {
        stack.push({
            type,
            state: type === 'object' ? 'keyOrEnd' : 'valueOrEnd',
            parentAfterClose: parentContext ? 'commaOrEnd' : null
        });
    };

    const updateParentOnClose = (closedContext) => {
        if (closedContext?.parentAfterClose && stack.length > 0) {
            stack[stack.length - 1].state = closedContext.parentAfterClose;
        }
    };

    for (const token of tokens) {
        const context = stack[stack.length - 1] || null;

        if (!context) {
            output.push(token.raw);
            if (token.type === '{') pushValueContext('object');
            else if (token.type === '[') pushValueContext('array');
            continue;
        }

        if (context.type === 'object') {
            if (context.state === 'keyOrEnd') {
                if (token.type === '}') {
                    output.push(token.raw);
                    updateParentOnClose(stack.pop());
                    continue;
                }

                if (token.type === 'STRING') {
                    output.push(token.raw);
                    context.state = 'colon';
                    continue;
                }
            }

            if (context.state === 'colon') {
                if (token.type !== ':') {
                    output.push(':');
                } else {
                    output.push(token.raw);
                    context.state = 'value';
                    continue;
                }

                context.state = 'value';
            }

            if (context.state === 'value') {
                output.push(token.raw);
                if (token.type === '{') pushValueContext('object', context);
                else if (token.type === '[') pushValueContext('array', context);
                else context.state = 'commaOrEnd';
                continue;
            }

            if (context.state === 'commaOrEnd') {
                if (token.type === ',') {
                    output.push(token.raw);
                    context.state = 'keyOrEnd';
                    continue;
                }

                if (token.type === '}') {
                    output.push(token.raw);
                    updateParentOnClose(stack.pop());
                    continue;
                }

                if (token.type === 'STRING') {
                    output.push(',');
                    output.push(token.raw);
                    context.state = 'colon';
                    continue;
                }
            }
        }

        if (context.type === 'array') {
            if (context.state === 'valueOrEnd') {
                if (token.type === ']') {
                    output.push(token.raw);
                    updateParentOnClose(stack.pop());
                    continue;
                }

                if (isValueToken(token)) {
                    output.push(token.raw);
                    if (token.type === '{') pushValueContext('object', context);
                    else if (token.type === '[') pushValueContext('array', context);
                    else context.state = 'commaOrEnd';
                    continue;
                }
            }

            if (context.state === 'commaOrEnd') {
                if (token.type === ',') {
                    output.push(token.raw);
                    context.state = 'valueOrEnd';
                    continue;
                }

                if (token.type === ']') {
                    output.push(token.raw);
                    updateParentOnClose(stack.pop());
                    continue;
                }

                if (isValueToken(token)) {
                    output.push(',');
                    output.push(token.raw);
                    if (token.type === '{') pushValueContext('object', context);
                    else if (token.type === '[') pushValueContext('array', context);
                    else context.state = 'commaOrEnd';
                    continue;
                }
            }
        }

        output.push(token.raw);
    }

    return output.join('');
}

function insertMissingCommaAtError(candidate, error) {
    const positionMatch = /position\s+(\d+)/i.exec(error?.message || '');
    if (!positionMatch) {
        return null;
    }

    const errorIndex = Number(positionMatch[1]);
    if (!Number.isInteger(errorIndex) || errorIndex <= 0 || errorIndex >= candidate.length) {
        return null;
    }

    let insertIndex = errorIndex;
    while (insertIndex < candidate.length && /\s/.test(candidate[insertIndex])) {
        insertIndex += 1;
    }

    let previousIndex = insertIndex - 1;
    while (previousIndex >= 0 && /\s/.test(candidate[previousIndex])) {
        previousIndex -= 1;
    }

    if (previousIndex < 0 || insertIndex >= candidate.length) {
        return null;
    }

    const previousChar = candidate[previousIndex];
    const nextChar = candidate[insertIndex];
    const previousCanEndValue = /["\]}0-9eElru]/.test(previousChar);
    const nextCanStartValue = /["{\[\-0-9tfn]/.test(nextChar);

    if (!previousCanEndValue || !nextCanStartValue) {
        return null;
    }

    return `${candidate.slice(0, insertIndex)},${candidate.slice(insertIndex)}`;
}

function tryParseCandidate(candidate) {
    const direct = tryParseJson(candidate);
    if (direct) {
        return { parsed: direct, parseError: null };
    }

    const sanitized = sanitizeCandidate(candidate);
    const sanitizedParsed = tryParseJson(sanitized);
    if (sanitizedParsed) {
        return { parsed: sanitizedParsed, parseError: null };
    }

    const structurallyRepaired = repairStructuralDelimiters(sanitized);
    const structuralParsed = tryParseJson(structurallyRepaired);
    if (structuralParsed) {
        return { parsed: structuralParsed, parseError: null };
    }

    let parseError = null;
    try {
        JSON.parse(structurallyRepaired);
    } catch (error) {
        parseError = error;
    }

    const commaFixed = insertMissingCommaAtError(structurallyRepaired, parseError);
    if (commaFixed) {
        const commaParsed = tryParseJson(commaFixed) || parseRecoveredJson(commaFixed);
        if (commaParsed) {
            return { parsed: commaParsed, parseError: null };
        }
    }

    const recovered = parseRecoveredJson(structurallyRepaired);
    if (recovered) {
        return { parsed: recovered, parseError: null };
    }

    return { parsed: null, parseError };
}

function rootMatches(parsed, expectedRoot) {
    if (expectedRoot === 'any') {
        return Array.isArray(parsed) || (!!parsed && typeof parsed === 'object');
    }

    if (expectedRoot === 'array') {
        return Array.isArray(parsed);
    }

    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
}

function buildCandidates(source, expectedRoot) {
    const candidates = [];
    const roots = expectedRoot === 'array'
        ? ['[']
        : expectedRoot === 'object'
            ? ['{']
            : ['{', '['];

    const trimmed = source.trim();
    if (trimmed) {
        candidates.push(trimmed);
    }

    for (const root of roots) {
        const startIndex = source.indexOf(root);
        if (startIndex !== -1) {
            const fragment = extractStructuredFragment(source, startIndex);
            if (fragment) {
                candidates.push(fragment);
            }
        }
    }

    return [...new Set(candidates.filter(Boolean))];
}

export function parseAIJsonResponse(responseText, options = {}) {
    const { expectedRoot = 'any' } = options;
    const normalized = stripMarkdownCodeBlocks(String(responseText || '')).trim();
    const candidates = buildCandidates(normalized, expectedRoot);
    let lastParseError = null;

    for (const candidate of candidates) {
        const { parsed, parseError } = tryParseCandidate(candidate);
        if (parsed && rootMatches(parsed, expectedRoot)) {
            return parsed;
        }

        if (parseError) {
            lastParseError = parseError;
        }
    }

    if (lastParseError) {
        throw lastParseError;
    }

    throw new SyntaxError('Failed to parse AI JSON response');
}