#!/usr/bin/env bash
# Runs intent-gate.sh against sample prompts. Needs jq or python3 to build the JSON.
# Usage: bash tests/test-intent-gate.sh
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gate="$here/intent-gate.sh"
pass=0; fail=0

mkjson() {
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg p "$1" '{hook_event_name:"UserPromptSubmit",session_id:"t",cwd:"/tmp",prompt:$p}'
  else
    python3 -c 'import sys,json; print(json.dumps({"hook_event_name":"UserPromptSubmit","session_id":"t","cwd":"/tmp","prompt":sys.argv[1]}))' "$1"
  fi
}

check() { # expect(flag|quiet) prompt
  local expect="$1" prompt="$2" out got
  out="$(mkjson "$prompt" | bash "$gate")"
  if [ -n "$out" ]; then got=flag; else got=quiet; fi
  if [ "$got" = "$expect" ]; then pass=$((pass+1)); else fail=$((fail+1)); printf 'FAIL expected=%s got=%s :: %s\n' "$expect" "$got" "$prompt"; fi
}

# Should flag
check flag "fix this"
check flag "make it better"
check flag "why is this failing"
check flag "improve the performance"
check flag "can you maybe clean up the sheet stuff"
check flag "do the thing like before"
check flag "[check] rename the variable in utils.py"

# Should stay quiet
check quiet "run the tests"
check quiet "commit and push"
check quiet "add a dark mode toggle"
check quiet "update the README with the install steps"
check quiet "rename getUserData to fetchUserData in src/api/user.ts"
check quiet "fix the null check in scripts/sync.gs:42"
check quiet "yes"
check quiet "continue"
check quiet "2"
check quiet "the first one"
check quiet "/model sonnet"
check quiet "fix this [go]"
check quiet "Build an n8n workflow that reads new rows from the Leads sheet, scores each lead against the ICP in the Docs template, writes the score back, and posts anything above 80 to the sales Slack channel with the lead name and source attached."

printf 'passed=%s failed=%s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
