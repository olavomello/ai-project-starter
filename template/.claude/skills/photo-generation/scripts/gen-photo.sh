#!/usr/bin/env bash
# Generate a photo via the OpenAI Images API from a request file.
# Requires: OPENAI_API_KEY, OPENAI_IMAGE_MODEL (set per current OpenAI docs), curl, python3.
# Verify endpoint/params against current OpenAI docs: https://platform.openai.com/docs/api-reference/images
set -euo pipefail
REQ="${1:?usage: gen-photo.sh <request.md>}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY not set}"; : "${OPENAI_IMAGE_MODEL:?OPENAI_IMAGE_MODEL not set}"
field() { sed -n "s/^$1:[[:space:]]*//p" "$REQ" | head -n1; }
PROMPT="$(field prompt)"; AVOID="$(field avoid)"; SIZE="$(field size)"; OUT="$(field output)"
[[ -n "$PROMPT" && -n "$OUT" ]] || { echo "request needs prompt: and output:" >&2; exit 1; }
[[ -n "$AVOID" ]] && PROMPT="$PROMPT. Avoid: $AVOID."
mkdir -p "$(dirname "$OUT")" .agents/media
BODY="$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"prompt":sys.argv[2],"size":sys.argv[3] or "1024x1024","n":1}))' "$OPENAI_IMAGE_MODEL" "$PROMPT" "$SIZE")"
RESP="$(curl -sS https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json" -d "$BODY")"
RESP="$RESP" python3 -c '
import base64, json, os, sys, urllib.request
r = json.loads(os.environ["RESP"])
if "error" in r: sys.exit("OpenAI error: " + str(r["error"].get("message", r["error"])))
d = r["data"][0]
if d.get("b64_json"): open(sys.argv[1], "wb").write(base64.b64decode(d["b64_json"]))
elif d.get("url"): urllib.request.urlretrieve(d["url"], sys.argv[1])
else: sys.exit("no image in response")
print("saved", sys.argv[1])
' "$OUT"
echo "$(date -u +%FT%TZ) $(basename "$REQ") -> $OUT model=$OPENAI_IMAGE_MODEL" >> .agents/media/log.txt
