#!/usr/bin/env bash
# UserPromptSubmit hook. Flags prompts that look underspecified.
# Prints nothing for clear prompts (zero token cost). Plain stdout is added to context.
#
# Overrides, anywhere in the prompt:  [go] skips the check,  [check] forces it.
# Tune the weights below if it flags too much or too little.

input="$(cat)"

extract_prompt() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$input" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("prompt",""))' 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).prompt||"")}catch(e){}})' 2>/dev/null
  fi
}

prompt="$(extract_prompt)"
[ -z "$prompt" ] && exit 0

lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"
words="$(printf '%s' "$prompt" | wc -w | tr -d ' ')"

# Bypass and force tokens.
case "$lc" in *"[go]"*) exit 0 ;; esac
force=0
case "$lc" in *"[check]"*) force=1 ;; esac

if [ "$force" -eq 0 ]; then
  # Slash commands are explicit already.
  case "$prompt" in /*) exit 0 ;; esac
  # Detailed prompts: assume the user said what they meant.
  [ "$words" -ge 45 ] && exit 0
  # Short answers to a question Claude just asked.
  if printf '%s' "$lc" | grep -Eq '^[[:space:]]*(yes|yep|yeah|y|no|nope|n|ok|okay|sure|continue|go ahead|go on|do it|proceed|sounds good|lgtm|thanks|thank you|stop|retry|next|done)[[:space:][:punct:]]*$'; then exit 0; fi
  if printf '%s' "$lc" | grep -Eq '^[[:space:]]*((option|number|#|the)[[:space:]]*)?([0-9]+|first|second|third|last|1st|2nd|3rd)([[:space:]]+(one|option))?[[:space:][:punct:]]*$'; then exit 0; fi
fi

# Anchors: things that pin the request to something concrete.
anchor=0
if printf '%s' "$prompt" | grep -Eq '([A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+|[A-Za-z0-9_-]+\.(js|ts|tsx|jsx|py|sh|md|json|ya?ml|toml|html|css|sql|gs|go|rs|java|rb|php|cpp|cs|txt|csv|env)([^A-Za-z0-9]|$)|`|https?://|[a-z]+_[a-z_]+|[a-z]+[A-Z][A-Za-z]+|[A-Za-z_]+\(\)|:[0-9]+|[Ll]ine [0-9]+|[A-Z]{3,})'; then anchor=1; fi

score=0
signals=""

if [ "$anchor" -eq 0 ]; then
  [ "$words" -le 10 ] && { score=$((score+1)); signals="$signals short-without-anchor"; }
  if printf '%s' "$lc" | grep -Eiqw '(this|that|these|those|it|them|the thing|the issue|the bug|the problem|same as|like before|as before|as usual|previous|above|the other)'; then
    score=$((score+2)); signals="$signals pronoun-without-antecedent"
  fi
  if [ "$words" -le 6 ] && printf '%s' "$lc" | grep -Eiqw '(fix|improve|clean up|cleanup|make it better|optimi[sz]e|refactor|update|handle|sort out|deal with|look into|take a look|check)'; then
    score=$((score+1)); signals="$signals generic-verb"
  fi
fi
if printf '%s' "$lc" | grep -Eiqw '(maybe|somehow|something like|kind of|sort of|or whatever|i guess|not sure|stuff|whatever)'; then
  score=$((score+2)); signals="$signals hedge-words"
fi
[ "$force" -eq 1 ] && { score=2; signals=" forced-by-[check]"; }

[ "$score" -lt 2 ] && exit 0

cat <<EOF
Intent check (opus-saver): a local heuristic flagged this prompt as possibly underspecified (signals:${signals}). Plugin policy for flagged prompts, in order:
1. Before any tool call, restate the request in one sentence.
2. Check whether earlier turns or the working directory already resolve what the prompt refers to. If they do, proceed and mention the assumption in half a sentence.
3. If an unresolved gap would change which files are touched or what gets built, ask one question with two or three concrete options and a default, then stop. Ask no more than one question.
4. If the gap would not change the work, proceed and state the assumption.
The user skips this check with [go] anywhere in a prompt.
EOF
