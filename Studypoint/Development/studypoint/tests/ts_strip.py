"""Tokenizer-driven TypeScript type-erasure preprocessor.

Transforms erasable TypeScript into valid standard JavaScript (ES2022)
so test files and modules can be executed directly inside Chromium V8
without external transpilers.
"""

from __future__ import annotations


class Token:
    __slots__ = ("kind", "text", "pos", "line", "col")

    def __init__(self, kind: str, text: str, pos: int, line: int = 1, col: int = 1):
        self.kind = kind
        self.text = text
        self.pos = pos
        self.line = line
        self.col = col

    def __repr__(self):
        return f"Token({self.kind}, {self.text!r}, pos={self.pos})"


def tokenize(source: str) -> list[Token]:
    """Tokenize JS/TS source into a linear list of tokens, accurately handling

    strings, template literals with nested expressions, comments, regex literals,
    identifiers, numbers, and operators.
    """
    tokens: list[Token] = []
    i = 0
    n = len(source)
    line = 1
    col = 1

    template_stack: list[int] = []

    def can_be_regex() -> bool:
        for t in reversed(tokens):
            if t.kind not in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                if t.kind == "PUNCT":
                    if t.text in (
                        "(",
                        "[",
                        "{",
                        ";",
                        ",",
                        ":",
                        "=",
                        "==",
                        "===",
                        "!=",
                        "!==",
                        "!",
                        "?",
                        "+",
                        "-",
                        "*",
                        "%",
                        "&",
                        "|",
                        "^",
                        "~",
                        "<",
                        ">",
                        "<=",
                        ">=",
                        "&&",
                        "||",
                        "??",
                        "=>",
                    ):
                        return True
                    return False
                if t.kind == "IDENT" and t.text in (
                    "return",
                    "case",
                    "typeof",
                    "delete",
                    "void",
                    "throw",
                    "instanceof",
                    "in",
                    "of",
                    "new",
                    "yield",
                    "await",
                ):
                    return True
                return False
        return True

    while i < n:
        ch = source[i]
        start_pos = i
        start_line = line
        start_col = col

        # 1. Inside template string characters?
        if template_stack and template_stack[-1] == -1:
            buf = ["}"]
            while i < n:
                c = source[i]
                if c == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1

                if c == "\\":
                    buf.append(c)
                    i += 1
                    if i < n:
                        buf.append(source[i])
                        if source[i] == "\n":
                            line += 1
                            col = 1
                        else:
                            col += 1
                        i += 1
                    continue
                elif c == "`":
                    buf.append(c)
                    i += 1
                    template_stack.pop()
                    tokens.append(
                        Token("TEMPLATE_TAIL", "".join(buf), start_pos, start_line, start_col)
                    )
                    break
                elif c == "$" and i + 1 < n and source[i + 1] == "{":
                    buf.append("${")
                    i += 2
                    col += 1
                    template_stack[-1] = 0
                    tokens.append(
                        Token("TEMPLATE_MIDDLE", "".join(buf), start_pos, start_line, start_col)
                    )
                    break
                else:
                    buf.append(c)
                    i += 1
            continue

        # 2. Whitespace
        if ch in " \t\r\n":
            while i < n and source[i] in " \t\r\n":
                if source[i] == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1
                i += 1
            tokens.append(
                Token("WHITESPACE", source[start_pos:i], start_pos, start_line, start_col)
            )
            continue

        # 3. Comments or Division
        if ch == "/":
            if i + 1 < n and source[i + 1] == "/":
                while i < n and source[i] != "\n":
                    col += 1
                    i += 1
                tokens.append(
                    Token("LINE_COMMENT", source[start_pos:i], start_pos, start_line, start_col)
                )
                continue
            elif i + 1 < n and source[i + 1] == "*":
                i += 2
                col += 2
                while i + 1 < n and not (source[i] == "*" and source[i + 1] == "/"):
                    if source[i] == "\n":
                        line += 1
                        col = 1
                    else:
                        col += 1
                    i += 1
                if i + 1 < n:
                    i += 2
                    col += 2
                tokens.append(
                    Token("BLOCK_COMMENT", source[start_pos:i], start_pos, start_line, start_col)
                )
                continue
            elif can_be_regex():
                i += 1
                col += 1
                in_char_class = False
                while i < n:
                    c = source[i]
                    if c == "\\":
                        i += 2
                        col += 2
                        continue
                    if c == "[" and not in_char_class:
                        in_char_class = True
                    elif c == "]" and in_char_class:
                        in_char_class = False
                    elif c == "/" and not in_char_class:
                        i += 1
                        col += 1
                        break
                    if c == "\n":
                        break
                    i += 1
                    col += 1
                while i < n and source[i].isalpha():
                    i += 1
                    col += 1
                tokens.append(Token("REGEX", source[start_pos:i], start_pos, start_line, start_col))
                continue

        # 4. Strings
        if ch in ("'", '"'):
            quote = ch
            i += 1
            col += 1
            while i < n:
                c = source[i]
                if c == "\\":
                    i += 2
                    col += 2
                    continue
                if c == quote:
                    i += 1
                    col += 1
                    break
                if c == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1
                i += 1
            tokens.append(Token("STRING", source[start_pos:i], start_pos, start_line, start_col))
            continue

        # 5. Template literal
        if ch == "`":
            i += 1
            col += 1
            buf = ["`"]
            is_no_sub = False
            while i < n:
                c = source[i]
                if c == "\\":
                    buf.append(c)
                    i += 1
                    if i < n:
                        buf.append(source[i])
                        if source[i] == "\n":
                            line += 1
                            col = 1
                        else:
                            col += 1
                        i += 1
                    continue
                if c == "`":
                    buf.append(c)
                    i += 1
                    col += 1
                    is_no_sub = True
                    break
                if c == "$" and i + 1 < n and source[i + 1] == "{":
                    buf.append("${")
                    i += 2
                    col += 2
                    template_stack.append(0)
                    break
                if c == "\n":
                    line += 1
                    col = 1
                else:
                    col += 1
                buf.append(c)
                i += 1

            kind = "TEMPLATE_NO_SUB" if is_no_sub else "TEMPLATE_HEAD"
            tokens.append(Token(kind, "".join(buf), start_pos, start_line, start_col))
            continue

        # 6. Braces in template expressions
        if ch == "{" and template_stack and template_stack[-1] >= 0:
            template_stack[-1] += 1
            i += 1
            col += 1
            tokens.append(Token("PUNCT", "{", start_pos, start_line, start_col))
            continue

        if ch == "}" and template_stack and template_stack[-1] >= 0:
            if template_stack[-1] == 0:
                template_stack[-1] = -1
                i += 1
                col += 1
                continue
            else:
                template_stack[-1] -= 1
                i += 1
                col += 1
                tokens.append(Token("PUNCT", "}", start_pos, start_line, start_col))
                continue

        # 7. Identifiers
        if ch.isalpha() or ch in ("_", "$"):
            while i < n and (source[i].isalnum() or source[i] in ("_", "$")):
                i += 1
                col += 1
            tokens.append(Token("IDENT", source[start_pos:i], start_pos, start_line, start_col))
            continue

        # 8. Numbers
        if ch.isdigit() or (ch == "." and i + 1 < n and source[i + 1].isdigit()):
            if ch == "0" and i + 1 < n and source[i + 1] in "xXbBoO":
                i += 2
                col += 2
                while i < n and (source[i].isalnum() or source[i] == "_"):
                    i += 1
                    col += 1
            else:
                while i < n and (
                    source[i].isdigit()
                    or source[i] == "."
                    or source[i] in "eE+-_"
                ):
                    if source[i] in "+-" and i > 0 and source[i - 1] not in "eE":
                        break
                    i += 1
                    col += 1
                if i < n and source[i] == "n":
                    i += 1
                    col += 1
            tokens.append(Token("NUMBER", source[start_pos:i], start_pos, start_line, start_col))
            continue

        # 9. Multi-char punctuators
        multi_chars = (
            "===",
            "!==",
            "...",
            "??=",
            "&&=",
            "||=",
            "**=",
            "<<=",
            ">>=",
            ">>>=",
            "=>",
            "==",
            "!=",
            "<=",
            ">=",
            "&&",
            "||",
            "??",
            "++",
            "--",
            "**",
            "<<",
            "+=",
            "-=",
            "*=",
            "/=",
            "%=",
            "&=",
            "|=",
            "^=",
            "?.",
        )
        matched_multi = None
        for op in multi_chars:
            if source.startswith(op, i):
                matched_multi = op
                break
        if matched_multi:
            i += len(matched_multi)
            col += len(matched_multi)
            tokens.append(
                Token("PUNCT", matched_multi, start_pos, start_line, start_col)
            )
            continue

        # 10. Single-char punctuator
        i += 1
        col += 1
        tokens.append(Token("PUNCT", ch, start_pos, start_line, start_col))

    return tokens


def strip_typescript(source: str) -> str:
    """Takes TypeScript source code (ES2022 + erasable types) and returns valid

    JavaScript by stripping type-only imports, type-only exports, interface declarations,
    type alias declarations, generic parameters, parameter and return types, variable types,
    as/satisfies assertions, and ambient declarations.
    """
    tokens = tokenize(source)
    m = len(tokens)

    to_remove: set[int] = set()

    def next_sig(idx: int) -> int:
        j = idx + 1
        while j < m and tokens[j].kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
            j += 1
        return j

    def prev_sig(idx: int) -> int:
        j = idx - 1
        while j >= 0 and tokens[j].kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
            j -= 1
        return j

    def match_brackets(start_idx: int, open_char: str, close_char: str) -> int:
        depth = 0
        j = start_idx
        while j < m:
            t = tokens[j]
            if t.text == open_char:
                depth += 1
            elif t.text == close_char:
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return m - 1

    def match_angle_backward(close_idx: int) -> int:
        depth = 0
        j = close_idx
        while j >= 0:
            t = tokens[j]
            if t.text == ">":
                depth += 1
            elif t.text == "<":
                depth -= 1
                if depth == 0:
                    return j
            elif t.text in (";", "{", "}") and depth == 0:
                break
            j -= 1
        return -1

    def is_valid_type_Select(open_angle: int, close_angle: int) -> bool:
        if close_angle <= open_angle:
            return False
        p_d = b_d = br_d = 0
        invalid_at_zero = {"&&", "||", "==", "===", "!=", "!==", "+=", "-=", "*=", "/=", ";"}
        for k in range(open_angle + 1, close_angle):
            txt = tokens[k].text
            if txt == "(":
                p_d += 1
            elif txt == ")":
                p_d = max(0, p_d - 1)
            elif txt == "{":
                b_d += 1
            elif txt == "}":
                b_d = max(0, b_d - 1)
            elif txt == "[":
                br_d += 1
            elif txt == "]":
                br_d = max(0, br_d - 1)
            elif p_d == 0 and b_d == 0 and br_d == 0 and txt in invalid_at_zero:
                return False
        return p_d == 0 and b_d == 0 and br_d == 0

    def strip_type(colon_idx: int, stop_tokens: set[str], allow_object_type: bool = True) -> int:
        """Strip `: Type` starting at colon_idx up to one of stop_tokens at depth 0."""
        to_remove.add(colon_idx)
        # Remove any optional '?' before colon
        p = prev_sig(colon_idx)
        if p >= 0 and tokens[p].text == "?":
            to_remove.add(p)

        j = colon_idx + 1
        paren_depth = 0
        brace_depth = 0
        bracket_depth = 0
        angle_depth = 0

        while j < m:
            tok = tokens[j]
            txt = tok.text

            if tok.kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                ns = next_sig(j - 1)
                if (
                    paren_depth == 0
                    and brace_depth == 0
                    and bracket_depth == 0
                    and angle_depth == 0
                    and ns < m
                    and tokens[ns].text in stop_tokens
                ):
                    return ns
                to_remove.add(j)
                j += 1
                continue

            if txt == "(":
                paren_depth += 1
            elif txt == ")":
                if paren_depth == 0 and brace_depth == 0 and bracket_depth == 0 and angle_depth == 0:
                    if ")" in stop_tokens:
                        return j
                paren_depth = max(0, paren_depth - 1)
            elif txt == "{":
                if not allow_object_type and paren_depth == 0 and brace_depth == 0 and bracket_depth == 0 and angle_depth == 0:
                    if "{" in stop_tokens:
                        return j
                brace_depth += 1
            elif txt == "}":
                if paren_depth == 0 and brace_depth == 0 and bracket_depth == 0 and angle_depth == 0:
                    if "}" in stop_tokens:
                        return j
                brace_depth = max(0, brace_depth - 1)
            elif txt == "[":
                bracket_depth += 1
            elif txt == "]":
                if paren_depth == 0 and brace_depth == 0 and bracket_depth == 0 and angle_depth == 0:
                    if "]" in stop_tokens:
                        return j
                bracket_depth = max(0, bracket_depth - 1)
            elif txt == "<":
                angle_depth += 1
            elif txt == ">" and prev_sig(j) >= 0 and tokens[prev_sig(j)].text != "=":
                if angle_depth > 0:
                    angle_depth -= 1
            elif (
                paren_depth == 0
                and brace_depth == 0
                and bracket_depth == 0
                and angle_depth == 0
            ):
                if txt in stop_tokens:
                    return j

            to_remove.add(j)
            j += 1
        return j

    def is_return_type_end(curr_idx: int, target_idx: int) -> bool:
        """Determine whether tokens[target_idx] at depth 0 ends a return type."""
        if target_idx >= m:
            return True
        ttxt = tokens[target_idx].text
        if ttxt in ("=>", ";"):
            return True
        if ttxt == "{":
            ps = prev_sig(target_idx)
            if ps >= 0 and tokens[ps].text in (":", "|", "&", "extends", "?"):
                return False
            return True
        return False

    def strip_return_type(colon_idx: int) -> int:
        """Strip function return type `: RetType` before `{` or `=>` or `;`."""
        to_remove.add(colon_idx)
        j = colon_idx + 1

        paren_depth = 0
        brace_depth = 0
        bracket_depth = 0
        angle_depth = 0

        while j < m:
            tok = tokens[j]
            txt = tok.text

            if tok.kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                ns = next_sig(j - 1)
                if (
                    paren_depth == 0
                    and brace_depth == 0
                    and bracket_depth == 0
                    and angle_depth == 0
                    and ns < m
                    and is_return_type_end(j, ns)
                ):
                    return ns
                to_remove.add(j)
                j += 1
                continue

            if txt == "(":
                paren_depth += 1
            elif txt == ")":
                paren_depth = max(0, paren_depth - 1)
            elif txt == "{":
                if (
                    paren_depth == 0
                    and brace_depth == 0
                    and bracket_depth == 0
                    and angle_depth == 0
                    and is_return_type_end(j, j)
                ):
                    return j
                brace_depth += 1
            elif txt == "}":
                brace_depth = max(0, brace_depth - 1)
            elif txt == "[":
                bracket_depth += 1
            elif txt == "]":
                bracket_depth = max(0, bracket_depth - 1)
            elif txt == "<":
                angle_depth += 1
            elif txt == ">":
                if angle_depth > 0:
                    angle_depth -= 1
            elif (
                paren_depth == 0
                and brace_depth == 0
                and bracket_depth == 0
                and angle_depth == 0
            ):
                if is_return_type_end(j, j):
                    return j

            to_remove.add(j)
            j += 1
        return j

    def strip_as_type(as_idx: int) -> int:
        """Strip `as Type` or `satisfies Type`."""
        to_remove.add(as_idx)
        # Also remove whitespace immediately preceding 'as' / 'satisfies'
        pw = as_idx - 1
        if pw >= 0 and tokens[pw].kind == "WHITESPACE":
            to_remove.add(pw)
        j = as_idx + 1
        p_depth = b_depth = br_depth = a_depth = 0
        stop_punct = {
            ",",
            ";",
            ")",
            "]",
            "}",
            "?",
            ":",
            "=",
            "==",
            "===",
            "!=",
            "!==",
            "+",
            "-",
            "*",
            "/",
            "%",
            "&&",
            "||",
            "??",
            "=>",
        }
        while j < m:
            tok = tokens[j]
            txt = tok.text

            if tok.kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                ns = next_sig(j - 1)
                if (
                    p_depth == 0
                    and b_depth == 0
                    and br_depth == 0
                    and a_depth == 0
                    and ns < m
                    and (tokens[ns].text in stop_punct or tokens[ns].text in ("as", "satisfies"))
                ):
                    return ns
                to_remove.add(j)
                j += 1
                continue

            if txt == "(":
                p_depth += 1
            elif txt == ")":
                if p_depth == 0 and b_depth == 0 and br_depth == 0 and a_depth == 0:
                    return j
                p_depth = max(0, p_depth - 1)
            elif txt == "{":
                b_depth += 1
            elif txt == "}":
                if p_depth == 0 and b_depth == 0 and br_depth == 0 and a_depth == 0:
                    return j
                b_depth = max(0, b_depth - 1)
            elif txt == "[":
                br_depth += 1
            elif txt == "]":
                if p_depth == 0 and b_depth == 0 and br_depth == 0 and a_depth == 0:
                    return j
                br_depth = max(0, br_depth - 1)
            elif txt == "<":
                a_depth += 1
            elif txt == ">":
                if a_depth > 0:
                    a_depth -= 1
            elif (
                p_depth == 0
                and b_depth == 0
                and br_depth == 0
                and a_depth == 0
            ):
                if txt in stop_punct or (tok.kind == "IDENT" and txt in ("as", "satisfies")):
                    return j

            to_remove.add(j)
            j += 1
        return j

    def strip_generic_params(open_angle_idx: int) -> int:
        close_idx = match_brackets(open_angle_idx, "<", ">")
        for k in range(open_angle_idx, close_idx + 1):
            to_remove.add(k)
        return close_idx + 1

    control_keywords = {
        "if",
        "for",
        "while",
        "switch",
        "with",
        "await",
        "return",
        "throw",
        "case",
        "yield",
        "typeof",
        "delete",
        "void",
        "new",
        "in",
        "of",
        "instanceof",
        "else",
        "do",
        "try",
        "finally",
    }

    idx = 0
    while idx < m:
        if idx in to_remove:
            idx += 1
            continue
        tok = tokens[idx]

        # 1. import type ...;
        if tok.kind == "IDENT" and tok.text == "import":
            ns = next_sig(idx)
            if ns < m and tokens[ns].kind == "IDENT" and tokens[ns].text == "type":
                nns = next_sig(ns)
                if nns < m and (tokens[nns].text == "{" or tokens[nns].kind == "IDENT"):
                    end_stmt = idx
                    p_depth = b_depth = br_depth = 0
                    while end_stmt < m:
                        t = tokens[end_stmt]
                        if t.text == "{":
                            b_depth += 1
                        elif t.text == "}":
                            b_depth = max(0, b_depth - 1)
                        elif t.text == "(":
                            p_depth += 1
                        elif t.text == ")":
                            p_depth = max(0, p_depth - 1)
                        elif t.text == "[":
                            br_depth += 1
                        elif t.text == "]":
                            br_depth = max(0, br_depth - 1)
                        elif t.text == ";" and b_depth == 0 and p_depth == 0 and br_depth == 0:
                            end_stmt += 1
                            break
                        elif b_depth == 0 and p_depth == 0 and br_depth == 0 and "\n" in t.text and end_stmt > ns:
                            ps_str = prev_sig(end_stmt)
                            if ps_str >= 0 and tokens[ps_str].kind == "STRING":
                                break
                        end_stmt += 1
                    for k in range(idx, end_stmt):
                        to_remove.add(k)
                    idx = end_stmt
                    continue

            # In normal import: import { type Foo, bar } from '...'
            if ns < m and tokens[ns].text == "{":
                close_brace = match_brackets(ns, "{", "}")
                k = ns + 1
                while k < close_brace:
                    if tokens[k].kind == "IDENT" and tokens[k].text == "type":
                        nk = next_sig(k)
                        if nk < close_brace and tokens[nk].kind == "IDENT":
                            to_remove.add(k)
                            to_remove.add(nk)
                            nnk = next_sig(nk)
                            if nnk < close_brace and tokens[nnk].text == ",":
                                to_remove.add(nnk)
                            else:
                                pk = prev_sig(k)
                                if pk > ns and tokens[pk].text == ",":
                                    to_remove.add(pk)
                            k = nnk
                            continue
                    k += 1

        # 2. export type { ... };
        if tok.kind == "IDENT" and tok.text == "export":
            ns = next_sig(idx)
            if ns < m and tokens[ns].kind == "IDENT" and tokens[ns].text == "type":
                nns = next_sig(ns)
                if nns < m and tokens[nns].text == "{":
                    close_brace = match_brackets(nns, "{", "}")
                    end_stmt = close_brace + 1
                    while end_stmt < m and tokens[end_stmt].text != ";":
                        if "\n" in tokens[end_stmt].text:
                            break
                        end_stmt += 1
                    if end_stmt < m and tokens[end_stmt].text == ";":
                        end_stmt += 1
                    for k in range(idx, end_stmt):
                        to_remove.add(k)
                    idx = end_stmt
                    continue

        # 3. interface Foo<T> { ... }
        is_export = tok.kind == "IDENT" and tok.text == "export"
        start_idx = idx
        cur_idx = next_sig(idx) if is_export else idx
        if cur_idx < m and tokens[cur_idx].kind == "IDENT" and tokens[cur_idx].text == "interface":
            body_open = cur_idx
            while body_open < m and tokens[body_open].text != "{":
                body_open += 1
            if body_open < m:
                body_close = match_brackets(body_open, "{", "}")
                end_stmt = body_close + 1
                ns = next_sig(body_close)
                if ns < m and tokens[ns].text == ";":
                    end_stmt = ns + 1
                for k in range(start_idx, end_stmt):
                    to_remove.add(k)
                idx = end_stmt
                continue

        # 4. type Foo = ...;
        if cur_idx < m and tokens[cur_idx].kind == "IDENT" and tokens[cur_idx].text == "type":
            ns = next_sig(cur_idx)
            if ns < m and tokens[ns].kind == "IDENT":
                after_name = next_sig(ns)
                if after_name < m and tokens[after_name].text in ("=", "<"):
                    end_stmt = after_name
                    p_depth = b_depth = br_depth = a_depth = 0
                    while end_stmt < m:
                        t = tokens[end_stmt]
                        if t.text == "(":
                            p_depth += 1
                        elif t.text == ")":
                            p_depth = max(0, p_depth - 1)
                        elif t.text == "{":
                            b_depth += 1
                        elif t.text == "}":
                            b_depth = max(0, b_depth - 1)
                        elif t.text == "[":
                            br_depth += 1
                        elif t.text == "]":
                            br_depth = max(0, br_depth - 1)
                        elif t.text == "<":
                            a_depth += 1
                        elif t.text == ">":
                            if a_depth > 0:
                                a_depth -= 1
                        elif t.text == ";" and p_depth == 0 and b_depth == 0 and br_depth == 0 and a_depth == 0:
                            end_stmt += 1
                            break
                        end_stmt += 1

                    for k in range(start_idx, end_stmt):
                        to_remove.add(k)
                    idx = end_stmt
                    continue

        # 5. declare ...;
        if tok.kind == "IDENT" and tok.text == "declare":
            end_stmt = idx
            while end_stmt < m and tokens[end_stmt].text != ";":
                if tokens[end_stmt].text == "{":
                    end_stmt = match_brackets(end_stmt, "{", "}") + 1
                    break
                end_stmt += 1
            if end_stmt < m and tokens[end_stmt].text == ";":
                end_stmt += 1
            for k in range(idx, end_stmt):
                to_remove.add(k)
            idx = end_stmt
            continue

        # 6. Function / class generics or call/new generics: `foo<T>(...)` or `<T>(...) =>`
        if tok.text == "<":
            ps = prev_sig(idx)
            if ps >= 0 and (
                (tokens[ps].kind == "IDENT" and tokens[ps].text not in control_keywords)
                or tokens[ps].text in ("=", ":", "(", ",", "async")
            ):
                close_a = match_brackets(idx, "<", ">")
                if close_a < m and is_valid_type_Select(idx, close_a):
                    ns_after_a = next_sig(close_a)
                    if ns_after_a < m and tokens[ns_after_a].text in ("(", "{", "extends", "implements"):
                        strip_generic_params(idx)
                        idx = close_a + 1
                        continue

        # 6b. Class field type declarations: `prop: Type;` or `prop?: Type;`
        if tok.kind == "IDENT" and tok.text not in control_keywords and tok.text not in ("default", "const", "let", "var", "function", "class", "interface", "type", "import", "export", "async", "static"):
            ps = prev_sig(idx)
            if ps >= 0 and tokens[ps].text in ("{", ";", "}", "readonly", "public", "private", "protected"):
                if tokens[ps].text in ("readonly", "public", "private", "protected"):
                    to_remove.add(ps)
                ns = next_sig(idx)
                colon_pos = -1
                if ns < m and tokens[ns].text == "?":
                    nns = next_sig(ns)
                    if nns < m and tokens[nns].text == ":":
                        colon_pos = nns
                elif ns < m and tokens[ns].text == ":":
                    colon_pos = ns
                if colon_pos != -1:
                    # Check if scanning this type hits `;` or `=` at depth 0 (and not `,` or `}`)
                    chk = colon_pos + 1
                    p_d = b_d = br_d = a_d = 0
                    is_class_field = False
                    while chk < m:
                        ct = tokens[chk].text
                        if ct == "(": p_d += 1
                        elif ct == ")": p_d = max(0, p_d - 1)
                        elif ct == "{": b_d += 1
                        elif ct == "}":
                            if p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0:
                                break
                            b_d = max(0, b_d - 1)
                        elif ct == "[": br_d += 1
                        elif ct == "]": br_d = max(0, br_d - 1)
                        elif ct == "<": a_d += 1
                        elif ct == ">":
                            if a_d > 0: a_d -= 1
                        elif p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0:
                            if ct in (";", "="):
                                is_class_field = True
                                break
                            if ct == ",":
                                break
                        chk += 1
                    if is_class_field:
                        strip_type(colon_pos, {";", "="}, allow_object_type=True)

        # 7. as Type / satisfies Type
        if tok.kind == "IDENT" and tok.text in ("as", "satisfies"):
            ps = prev_sig(idx)
            if ps >= 0 and (
                tokens[ps].kind in ("IDENT", "NUMBER", "STRING", "REGEX")
                or tokens[ps].text in (")", "]", "}")
            ):
                idx = strip_as_type(idx)
                continue

        # 8. Variable declarations: const / let / var
        if tok.kind == "IDENT" and tok.text in ("const", "let", "var"):
            cur = next_sig(idx)
            while cur < m:
                if tokens[cur].text in ("{", "["):
                    close_char = "}" if tokens[cur].text == "{" else "]"
                    cur = match_brackets(cur, tokens[cur].text, close_char)

                cur = next_sig(cur)
                if cur < m and tokens[cur].text == "!":
                    to_remove.add(cur)
                    cur = next_sig(cur)

                if cur < m and tokens[cur].text == ":":
                    # Type annotation on variable ends at '=' or ',' or ';'
                    cur = strip_type(cur, {"=", ",", ";"}, allow_object_type=True)

                if cur < m and tokens[cur].text == "=":
                    p_d = b_d = br_d = 0
                    while cur < m:
                        t = tokens[cur]
                        if t.text == "(":
                            p_d += 1
                        elif t.text == ")":
                            p_d = max(0, p_d - 1)
                        elif t.text == "{":
                            b_d += 1
                        elif t.text == "}":
                            b_d = max(0, b_d - 1)
                        elif t.text == "[":
                            br_d += 1
                        elif t.text == "]":
                            br_d = max(0, br_d - 1)
                        elif t.text == "," and p_d == 0 and b_d == 0 and br_d == 0:
                            break
                        elif t.text == ";" and p_d == 0 and b_d == 0 and br_d == 0:
                            break
                        cur += 1

                if cur < m and tokens[cur].text == ",":
                    cur = next_sig(cur)
                    continue
                else:
                    break

        # 9. Function parameter list `(`
        if tok.text == "(":
            close_p = match_brackets(idx, "(", ")")
            ps = prev_sig(idx)
            if ps >= 0 and tokens[ps].text == ">":
                open_a = match_angle_backward(ps)
                if open_a > 0:
                    ps = prev_sig(open_a)

            is_func_decl = False
            is_arrow = False
            ns_after = next_sig(close_p)

            if ps >= 0:
                p_tok = tokens[ps]
                if p_tok.text in ("function", "catch"):
                    is_func_decl = True
                elif p_tok.kind == "IDENT" and p_tok.text not in control_keywords:
                    pps = prev_sig(ps)
                    if pps >= 0 and tokens[pps].text in ("function", "async", "get", "set", "static", "public", "private", "protected"):
                        is_func_decl = True
                    elif ns_after < m and tokens[ns_after].text == "{":
                        is_func_decl = True
                    elif ns_after < m and tokens[ns_after].text == ":":
                        # Check if `: RetType` ends with `{` or `;`
                        chk = ns_after + 1
                        p_d = b_d = br_d = a_d = 0
                        while chk < m:
                            txt = tokens[chk].text
                            if txt == "(": p_d += 1
                            elif txt == ")": p_d = max(0, p_d - 1)
                            elif txt == "{":
                                if p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0 and is_return_type_end(chk, chk):
                                    is_func_decl = True
                                    break
                                b_d += 1
                            elif txt == "}": b_d = max(0, b_d - 1)
                            elif txt == "[": br_d += 1
                            elif txt == "]": br_d = max(0, br_d - 1)
                            elif txt == "<": a_d += 1
                            elif txt == ">":
                                if a_d > 0: a_d -= 1
                            elif p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0 and txt in (";", ",", "=>"):
                                break
                            chk += 1

            if ns_after < m and tokens[ns_after].text == "=>":
                is_arrow = True
            elif ns_after < m and tokens[ns_after].text == ":":
                check = ns_after + 1
                p_d = b_d = br_d = a_d = 0
                while check < m:
                    txt = tokens[check].text
                    if txt == "(":
                        p_d += 1
                    elif txt == ")":
                        p_d = max(0, p_d - 1)
                    elif txt == "{":
                        if p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0 and is_return_type_end(check, check):
                            if ps >= 0 and tokens[ps].kind == "IDENT" and tokens[ps].text not in control_keywords:
                                is_func_decl = True
                            break
                        b_d += 1
                    elif txt == "}":
                        b_d = max(0, b_d - 1)
                    elif txt == "[":
                        br_d += 1
                    elif txt == "]":
                        br_d = max(0, br_d - 1)
                    elif txt == "<":
                        a_d += 1
                    elif txt == ">":
                        if a_d > 0:
                            a_d -= 1
                    elif (
                        txt == "=>"
                        and p_d == 0
                        and b_d == 0
                        and br_d == 0
                        and a_d == 0
                    ):
                        is_arrow = True
                        break
                    elif p_d == 0 and b_d == 0 and br_d == 0 and a_d == 0 and txt in (";", ","):
                        break
                    check += 1

            is_param_list = is_func_decl or is_arrow

            if is_param_list:
                close_p = match_brackets(idx, "(", ")")
                p_idx = idx + 1
                while p_idx < close_p:
                    ptok = tokens[p_idx]
                    if ptok.kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                        p_idx += 1
                        continue

                    if ptok.text == "...":
                        p_idx = next_sig(p_idx)
                        if p_idx >= close_p:
                            break
                        ptok = tokens[p_idx]

                    if ptok.text in ("{", "["):
                        c_char = "}" if ptok.text == "{" else "]"
                        p_idx = match_brackets(p_idx, ptok.text, c_char)
                        p_idx += 1
                    else:
                        p_idx += 1

                    ns_p = p_idx
                    while ns_p < close_p and tokens[ns_p].kind in ("WHITESPACE", "LINE_COMMENT", "BLOCK_COMMENT"):
                        ns_p += 1
                    if ns_p < close_p and tokens[ns_p].text == "?":
                        nns_p = next_sig(ns_p)
                        if nns_p < close_p and tokens[nns_p].text == ":":
                            to_remove.add(ns_p)
                            p_idx = strip_type(nns_p, {",", "=", ")"}, allow_object_type=True)
                            continue
                        else:
                            p_idx = ns_p + 1
                            continue
                    elif ns_p < close_p and tokens[ns_p].text == ":":
                        p_idx = strip_type(ns_p, {",", "=", ")"}, allow_object_type=True)
                        continue

                # Return type after parameter list: `: RetType`
                ns_after_p = next_sig(close_p)
                if ns_after_p < m and tokens[ns_after_p].text == ":":
                    strip_return_type(ns_after_p)

        idx += 1

    out: list[str] = []
    for k in range(m):
        if k not in to_remove:
            out.append(tokens[k].text)

    return "".join(out)


def self_test() -> None:
    cases = [
        (
            "function sum(a: number, b?: number, c: number = 0): number { return a + (b || 0) + c; }",
            "function sum(a, b, c = 0) { return a + (b || 0) + c; }",
        ),
        (
            "const f = (x: string): boolean => x.length > 0;",
            "const f = (x) => x.length > 0;",
        ),
        (
            "function destr({ a, b: alias }: { a: number; b: string }): void {}",
            "function destr({ a, b: alias }) {}",
        ),
        (
            "const { x, y: yAlias }: { x: string; y: number } = get();",
            "const { x, y: yAlias } = get();",
        ),
        (
            "function identity<T>(arg: T): T { return arg; }",
            "function identity(arg) { return arg; }",
        ),
        (
            "export interface User { name: string; }\nconst a = 1;",
            "const a = 1;",
        ),
        (
            "export type ID = string | number;\nconst b = 2;",
            "const b = 2;",
        ),
        (
            "import type { A, B } from './types.ts';\nconst c = 3;",
            "const c = 3;",
        ),
        (
            "const res = cond ? val1 : val2;",
            "const res = cond ? val1 : val2;",
        ),
        (
            "const map = { a: 1, b: 2 };",
            "const map = { a: 1, b: 2 };",
        ),
        (
            "const val = (raw as string);",
            "const val = (raw);",
        ),
        (
            "const chain = x as unknown as string;",
            "const chain = x;",
        ),
        (
            "function getObj(a: number): { x: number; y: number }[] { return [{ x: a, y: a }]; }",
            "function getObj(a) { return [{ x: a, y: a }]; }",
        ),
        (
            "async function req<T = any>(u: string): Promise<Array<T>> { const m = new Map<string, T>(); return []; }",
            "async function req(u) { const m = new Map(); return []; }",
        ),
        (
            "class Err extends Error { status: number; code: string | null; constructor(s: number = 500) { super(); this.status = s; this.code = null; } }",
            "class Err extends Error { status; code; constructor(s = 500) { super(); this.status = s; this.code = null; } }",
        ),
    ]

    for orig, expected in cases:
        res = strip_typescript(orig).strip()
        assert res == expected, f"Mismatch:\nGot:      {res}\nExpected: {expected}"

    print("PASS: ts_strip self_test passed all cases!")


if __name__ == "__main__":
    self_test()

